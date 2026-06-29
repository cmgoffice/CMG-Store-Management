import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import {
  collection,
  doc,
  getDocs,
  type DocumentData,
  setDoc,
  writeBatch,
  onSnapshot,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { APP_NAME } from '../config/firestore';
import { db, masterDataDb, masterDataProjectsPath, storage } from '../firebase';
import { processPrPoReceivePayload } from '../services/prPoReceiveIntegration';
import {
  dispatchRecords as mockDispatchRecords,
  projects as mockProjects,
  receivingRequests as mockReceivingRequests,
  stockItems as mockStockItems,
} from '../data/mockData';
import type {
  DispatchRecord,
  PrPoReceivePayload,
  PrPoReceiveResponse,
  Project,
  ProjectStatus,
  ReceivingRequest,
  ReceivingRequestItem,
  ReceivingRequestStatus,
  StockItem,
} from '../types/models';
import { getStockItemId } from '../utils/stockItem';
import { useAuth } from './AuthContext';

interface CreateDispatchLineInput {
  receiveNo: string;
  qty: number;
}

interface CreateDispatchInput {
  sourceProjectNo: string;
  items: CreateDispatchLineInput[];
  projectNo: string;
  transport: string;
  note: string;
  photos: File[];
}

interface InventoryContextValue {
  projects: Project[];
  activeProjects: Project[];
  stockItems: StockItem[];
  receivingRequests: ReceivingRequest[];
  dispatchRecords: DispatchRecord[];
  updateProjectStatus: (projectNo: string, status: ProjectStatus) => Promise<void>;
  createDispatch: (input: CreateDispatchInput) => Promise<void>;
  approveReceipt: (receiveNo: string) => Promise<void>;
  approveReceivingRequest: (requestId: string) => Promise<void>;
  receiveDispatch: (dispatchId: string) => Promise<void>;
  receiveNewItem: (item: StockItem) => Promise<void>;
  receivePrPoPayload: (payload: PrPoReceivePayload) => Promise<PrPoReceiveResponse>;
  activeProjectNo: string;
  setActiveProjectNo: (projectNo: string) => void;
}

const InventoryContext = createContext<InventoryContextValue | undefined>(undefined);

const MASTER_LOCKED_FIELDS: NonNullable<Project['lockedFields']> = [
  'projectNo',
  'projectName',
  'location',
  'projectManager',
  'constructionManager',
];

interface MasterDataProject {
  id?: string;
  jobNo?: string;
  name?: string;
  location?: string;
  pmName?: string;
  cmName?: string;
}

function normalizeProjectStatus(value: unknown): ProjectStatus {
  return String(value).trim().toLowerCase() === 'disactive' ? 'Disactive' : 'Active';
}

function normalizeReceivingRequestStatus(value: unknown): ReceivingRequestStatus {
  const normalized = String(value || 'pending').trim().toLowerCase();

  if (
    normalized === 'approved' ||
    normalized === 'rejected' ||
    normalized === 'cancelled'
  ) {
    return normalized;
  }

  return 'pending';
}

function formatPersonName(firstName?: string, lastName?: string, fallback = 'Unknown User') {
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  return fullName || fallback;
}

function createDispatchNumber() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `DSP-${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

function createProjectLabel(projectNo: string) {
  return `Project ${projectNo}`;
}

function createProjectStoreLocation(projectNo: string) {
  return `Store ${projectNo}`;
}

function createTransitLocation(projectNo: string) {
  return `In Transit to ${createProjectStoreLocation(projectNo)}`;
}

function roundAmount(value: number) {
  return Math.round(value * 100) / 100;
}

function calculatePartialAmount(totalAmount: number, totalQty: number, selectedQty: number) {
  if (totalQty <= 0 || selectedQty <= 0) {
    return 0;
  }

  return roundAmount((totalAmount * selectedQty) / totalQty);
}

function createDispatchStockReceiveNo(receiveNo: string, dispatchNo: string, index: number) {
  return `${receiveNo}-${dispatchNo}-${String(index + 1).padStart(2, '0')}`;
}

function createReceivingStockReceiveNo(request: ReceivingRequest, item: ReceivingRequestItem, index: number) {
  if (item.stockReceiveNo) {
    return item.stockReceiveNo;
  }

  if (request.items.length === 1) {
    return request.receiveNo;
  }

  return `${request.receiveNo}-${String(index + 1).padStart(2, '0')}`;
}

function extractProjectNo(projectLabel: string) {
  return projectLabel.replace(/^Project\s+/i, '').trim();
}

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeDateText(value: unknown) {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate: () => Date }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }

  return '';
}

function normalizeNumber(value: unknown, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => normalizeText(item)).filter(Boolean)
    : [];
}

function normalizeBoolean(value: unknown) {
  return value === true || String(value).trim().toLowerCase() === 'true';
}

function normalizeProjectNoText(value: unknown) {
  const text = normalizeText(value);
  const projectMatch = text.match(/\bJ[-\s]?0*(\d+)\b/i);

  if (projectMatch) {
    return `J${Number(projectMatch[1])}`;
  }

  return text;
}

function normalizeProjectNoFromRequest(data: DocumentData) {
  const projectCandidates = [
    data.projectNo,
    data.projectItemCode,
    data.projectId,
    data.receiveNo,
    data.rpNo,
    data.documentNo,
    data.id,
    data.idempotencyKey,
  ];

  for (const candidate of projectCandidates) {
    const projectNo = normalizeProjectNoText(candidate);
    if (projectNo) {
      return projectNo;
    }
  }

  return '';
}

function parseReceivingItems(value: unknown) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
}

function normalizeReceivingRequestItem(data: DocumentData, index: number): ReceivingRequestItem {
  const receivedQty = normalizeNumber(
    data.receivedQty ?? data.qtyReceive ?? data.qty ?? data.QTY ?? data.quantity
  );
  const orderedQty = normalizeNumber(data.orderedQty, receivedQty);
  const price = normalizeNumber(data.price ?? data.unitPrice);
  const amount = normalizeNumber(data.amount, price > 0 ? price * receivedQty : 0);
  const materialNo = normalizeText(data.materialNo ?? data.iditem);

  return {
    itemNo:
      normalizeText(data.itemNo ?? data.materialNo ?? data.iditem ?? data.descriptionKey) ||
      `ITEM-${String(index + 1).padStart(2, '0')}`,
    itemDescription: normalizeText(data.itemDescription ?? data.description ?? data.itemName),
    orderedQty,
    receivedQty,
    unit: normalizeText(data.unit),
    price,
    amount,
    materialNo,
    photos: normalizeStringArray(data.photos),
    stockReceiveNo: normalizeText(data.stockReceiveNo),
  };
}

function normalizeReceivingRequest(data: DocumentData, fallbackId: string): ReceivingRequest {
  const items = parseReceivingItems(data.items)
    .map((item, index) => normalizeReceivingRequestItem(item as DocumentData, index))
    .filter((item) => item.receivedQty > 0);
  const projectNo = normalizeProjectNoFromRequest(data);
  const totalQty = normalizeNumber(data.totalQty, items.reduce((sum, item) => sum + item.receivedQty, 0));
  const totalAmount = normalizeNumber(data.totalAmount, items.reduce((sum, item) => sum + item.amount, 0));

  return {
    id: normalizeText(data.id) || fallbackId,
    documentNo: normalizeText(data.documentNo),
    receiveNo: normalizeText(data.receiveNo ?? data.rpNo) || fallbackId,
    poNo: normalizeText(data.poNo ?? data.documentNo),
    prNo: normalizeText(data.prNo),
    poType: normalizeText(data.poType ?? data.receiveType),
    poId: normalizeText(data.poId),
    projectId: normalizeText(data.projectId),
    projectNo,
    projectName: normalizeText(data.projectName) || normalizeProjectNoText(data.projectId) || projectNo,
    projectItemCode: normalizeText(data.projectItemCode),
    location: normalizeText(data.location),
    vendorName: normalizeText(data.vendorName),
    receiveName: normalizeText(data.receiveName ?? data.receivedByName),
    receiveDate: normalizeDateText(data.receiveDate ?? data.receivedDate),
    receivedByUid: normalizeText(data.receivedByUid),
    receivedByName: normalizeText(data.receivedByName),
    note: normalizeText(data.note),
    sourceApp: normalizeText(data.sourceApp) || (normalizeBoolean(data.autoCreatedFromPoApproval) ? 'PO Approval' : ''),
    externalDocId: normalizeText(data.externalDocId ?? data.poId ?? data.documentNo ?? data.rpNo ?? data.idempotencyKey),
    autoCreatedFromPoApproval: normalizeBoolean(data.autoCreatedFromPoApproval),
    requestStatus: normalizeReceivingRequestStatus(data.requestStatus ?? data.status),
    items,
    totalQty,
    totalAmount,
    requestedAt: normalizeDateText(data.requestedAt) || normalizeDateText(data.createdAt) || new Date().toISOString(),
    approvedAt: normalizeDateText(data.approvedAt),
    approvedByUid: normalizeText(data.approvedByUid),
    approvedByName: normalizeText(data.approvedByName),
    approvedByEmail: normalizeText(data.approvedByEmail),
    stockReceiveNos: normalizeStringArray(data.stockReceiveNos),
  };
}

function normalizeLocalProject(data: Partial<Project>, fallbackId: string): Project | null {
  const projectNo = normalizeText(data.projectNo) || normalizeText((data as { jobNo?: string }).jobNo) || fallbackId;
  if (!projectNo) {
    return null;
  }

  return {
    projectId: normalizeText(data.projectId) || normalizeText((data as { id?: string }).id) || projectNo,
    projectNo,
    projectName: normalizeText(data.projectName) || normalizeText((data as { name?: string }).name),
    location: normalizeText(data.location),
    projectManager: normalizeText(data.projectManager),
    constructionManager: normalizeText(data.constructionManager),
    status: normalizeProjectStatus(data.status),
    source: 'local',
  };
}

function normalizeMasterProject(data: MasterDataProject, fallbackId: string): Project | null {
  const projectNo = normalizeText(data.jobNo) || fallbackId;
  if (!projectNo) {
    return null;
  }

  return {
    projectId: normalizeText(data.id) || projectNo,
    projectNo,
    projectName: normalizeText(data.name),
    location: normalizeText(data.location),
    projectManager: normalizeText(data.pmName),
    constructionManager: normalizeText(data.cmName),
    status: 'Active',
    source: 'master',
    lockedFields: MASTER_LOCKED_FIELDS,
  };
}

function mergeProjects(
  localProjects: Project[],
  masterProjects: Project[],
  projectStatuses: Record<string, ProjectStatus>
) {
  const merged = new Map<string, Project>();

  localProjects.forEach((project) => {
    merged.set(project.projectNo, {
      ...project,
      status: projectStatuses[project.projectNo] ?? project.status ?? 'Active',
      source: 'local',
    });
  });

  masterProjects.forEach((project) => {
    if (merged.has(project.projectNo)) {
      return;
    }

    merged.set(project.projectNo, {
      ...project,
      status: projectStatuses[project.projectNo] ?? project.status ?? 'Active',
      source: 'master',
      lockedFields: MASTER_LOCKED_FIELDS,
    });
  });

  return Array.from(merged.values()).sort((a, b) => a.projectNo.localeCompare(b.projectNo));
}

export function InventoryProvider({ children }: PropsWithChildren) {
  const { userProfile } = useAuth();
  const [items, setItems] = useState<StockItem[]>([]);
  const [receivingRequestList, setReceivingRequestList] = useState<ReceivingRequest[]>([]);
  const [localProjects, setLocalProjects] = useState<Project[]>([]);
  const [masterProjects, setMasterProjects] = useState<Project[]>([]);
  const [projectStatuses, setProjectStatuses] = useState<Record<string, ProjectStatus>>({});
  const [dispatchList, setDispatchList] = useState<DispatchRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeProjectNo, setActiveProjectNo] = useState<string>('');
  const projectList = useMemo(
    () => mergeProjects(localProjects, masterProjects, projectStatuses),
    [localProjects, masterProjects, projectStatuses]
  );

  useEffect(() => {
    let unsubProjects = () => {};
    let unsubMasterProjects = () => {};
    let unsubProjectStatuses = () => {};
    let unsubStock = () => {};
    let unsubDispatch = () => {};
    let unsubReceivingRequests = () => {};

    async function initializeDatabase() {
      try {
        const projectsCol = collection(db, APP_NAME, 'root', 'projects');
        const stockCol = collection(db, APP_NAME, 'root', 'stockItems');
        const dispatchCol = collection(db, APP_NAME, 'root', 'dispatchRecords');
        const receivingRequestsCol = collection(db, APP_NAME, 'root', 'receivingRequests');

        const [projectsSnapshot, stockSnapshot, dispatchSnapshot, receivingRequestsSnapshot] = await Promise.all([
          getDocs(projectsCol),
          getDocs(stockCol),
          getDocs(dispatchCol),
          getDocs(receivingRequestsCol),
        ]);

        if (projectsSnapshot.empty && stockSnapshot.empty) {
          const batch = writeBatch(db);

          mockProjects.forEach((proj) => {
            const docRef = doc(db, APP_NAME, 'root', 'projects', proj.projectNo);
            batch.set(docRef, proj);
          });

          mockStockItems.forEach((item) => {
            const docRef = doc(db, APP_NAME, 'root', 'stockItems', item.receiveNo);
            batch.set(docRef, item);
          });

          await batch.commit();
        }

        if (dispatchSnapshot.empty) {
          const batch = writeBatch(db);
          mockDispatchRecords.forEach((record) => {
            const docRef = doc(db, APP_NAME, 'root', 'dispatchRecords', record.id);
            batch.set(docRef, record);
          });
          await batch.commit();
        }

        if (receivingRequestsSnapshot.empty) {
          const batch = writeBatch(db);
          mockReceivingRequests.forEach((request) => {
            const docRef = doc(db, APP_NAME, 'root', 'receivingRequests', request.id);
            batch.set(docRef, request);
          });
          await batch.commit();
        }
      } catch (error) {
        console.error('Failed to query or seed Firestore databases on init:', error);
      }

      const projectsColRef = collection(db, APP_NAME, 'root', 'projects');
      unsubProjects = onSnapshot(
        projectsColRef,
        (snapshot) => {
          const loadedProjects = snapshot.docs
            .map((projectDoc) => normalizeLocalProject(projectDoc.data() as Partial<Project>, projectDoc.id))
            .filter((project): project is Project => project !== null);
          loadedProjects.sort((a, b) => a.projectNo.localeCompare(b.projectNo));
          setLocalProjects(loadedProjects);
        },
        (error) => {
          console.error('Failed to listen to projects updates:', error);
          setLocalProjects(mockProjects.map((project) => ({ ...project, source: 'local' })));
        }
      );

      if (masterDataDb && masterDataProjectsPath) {
        const sanitizedPath = masterDataProjectsPath.replace(/^\/+|\/+$/g, '');
        const pathSegments = sanitizedPath.split('/').filter(Boolean);

        if (pathSegments.length % 2 === 1) {
          const masterProjectsColRef = collection(masterDataDb, sanitizedPath);
          unsubMasterProjects = onSnapshot(
            masterProjectsColRef,
            (snapshot) => {
              const loadedProjects = snapshot.docs
                .map((projectDoc) => normalizeMasterProject(projectDoc.data() as MasterDataProject, projectDoc.id))
                .filter((project): project is Project => project !== null);
              loadedProjects.sort((a, b) => a.projectNo.localeCompare(b.projectNo));
              setMasterProjects(loadedProjects);
            },
            (error) => {
              console.error('Failed to listen to MasterData project updates:', error);
              setMasterProjects([]);
            }
          );
        } else {
          console.error('Invalid MasterData projects path. Expected a Firestore collection path:', masterDataProjectsPath);
          setMasterProjects([]);
        }
      } else {
        setMasterProjects([]);
      }

      const projectStatusesColRef = collection(db, APP_NAME, 'root', 'projectStatuses');
      unsubProjectStatuses = onSnapshot(
        projectStatusesColRef,
        (snapshot) => {
          const loadedStatuses = snapshot.docs.reduce<Record<string, ProjectStatus>>((acc, statusDoc) => {
            const data = statusDoc.data() as DocumentData;
            acc[statusDoc.id] = normalizeProjectStatus(data.status);
            return acc;
          }, {} as Record<string, ProjectStatus>);
          setProjectStatuses(loadedStatuses);
        },
        (error) => {
          console.error('Failed to listen to project status updates:', error);
          setProjectStatuses({});
        }
      );

      const stockColRef = collection(db, APP_NAME, 'root', 'stockItems');
      unsubStock = onSnapshot(
        stockColRef,
        (snapshot) => {
          const loadedItems = snapshot.docs.map((d) => ({
            ...(d.data() as StockItem),
            stockItemId: d.id,
          }));
          loadedItems.sort((a, b) => b.receiveNo.localeCompare(a.receiveNo));
          setItems(loadedItems);
          setLoading(false);
        },
        (error) => {
          console.error('Failed to listen to stockItems updates:', error);
          setItems(mockStockItems);
          setLoading(false);
        }
      );

      const dispatchColRef = collection(db, APP_NAME, 'root', 'dispatchRecords');
      unsubDispatch = onSnapshot(
        dispatchColRef,
        (snapshot) => {
          const loadedRecords = snapshot.docs.map((d) => d.data() as DispatchRecord);
          loadedRecords.sort((a, b) => b.dispatchedAt.localeCompare(a.dispatchedAt));
          setDispatchList(loadedRecords);
        },
        (error) => {
          console.error('Failed to listen to dispatch updates:', error);
          setDispatchList(mockDispatchRecords);
        }
      );

      const receivingRequestsColRef = collection(db, APP_NAME, 'root', 'receivingRequests');
      unsubReceivingRequests = onSnapshot(
        receivingRequestsColRef,
        (snapshot) => {
          const loadedRequests = snapshot.docs.map((d) => normalizeReceivingRequest(d.data(), d.id));
          loadedRequests.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
          setReceivingRequestList(loadedRequests);
        },
        (error) => {
          console.error('Failed to listen to receiving request updates:', error);
          setReceivingRequestList(mockReceivingRequests);
        }
      );
    }

    initializeDatabase();

    return () => {
      unsubProjects();
      unsubMasterProjects();
      unsubProjectStatuses();
      unsubStock();
      unsubDispatch();
      unsubReceivingRequests();
    };
  }, []);

  const visibleProjects = useMemo(() => {
    if (!userProfile) {
      return [];
    }

    if (
      userProfile.role.includes('MasterAdmin') ||
      userProfile.role.includes('SuperAdmin') ||
      userProfile.role.includes('Admin') ||
      userProfile.role.includes('Store Center')
    ) {
      return projectList;
    }

    const assigned = userProfile.assignedProjects || [];
    return projectList.filter((proj) => assigned.includes(proj.projectNo));
  }, [projectList, userProfile]);

  const activeVisibleProjects = useMemo(
    () => visibleProjects.filter((project) => normalizeProjectStatus(project.status) === 'Active'),
    [visibleProjects]
  );

  const visibleDispatchRecords = useMemo(() => {
    if (!userProfile) {
      return [];
    }

    if (
      userProfile.role.includes('MasterAdmin') ||
      userProfile.role.includes('SuperAdmin') ||
      userProfile.role.includes('Admin') ||
      userProfile.role.includes('Store Center')
    ) {
      return dispatchList;
    }

    const assigned = new Set(userProfile.assignedProjects || []);
    return dispatchList.filter(
      (record) =>
        assigned.has(record.sourceProjectNo) ||
        assigned.has(record.destinationProjectNo)
    );
  }, [dispatchList, userProfile]);

  useEffect(() => {
    if (activeVisibleProjects.length > 0) {
      const isValid = activeVisibleProjects.some((p) => p.projectNo === activeProjectNo);
      if (!activeProjectNo || !isValid) {
        setActiveProjectNo(activeVisibleProjects[0].projectNo);
      }
    } else {
      setActiveProjectNo('');
    }
  }, [activeVisibleProjects, activeProjectNo]);

  const createDispatch = useCallback(async ({
    sourceProjectNo,
    items: selectedLines,
    projectNo,
    transport,
    note,
    photos,
  }: CreateDispatchInput) => {
    const normalizedLines = selectedLines
      .map((line) => ({
        receiveNo: line.receiveNo,
        qty: Number(line.qty),
      }))
      .filter((line) => line.receiveNo && Number.isFinite(line.qty) && line.qty > 0);

    if (!normalizedLines.length || !sourceProjectNo || !projectNo || sourceProjectNo === projectNo) {
      return;
    }

    const sourceProject = projectList.find((project) => project.projectNo === sourceProjectNo);
    const targetProject = projectList.find((project) => project.projectNo === projectNo);
    const selectedItems = normalizedLines.map((line) => {
      const sourceItem = items.find((item) => getStockItemId(item) === line.receiveNo);

      if (
        !sourceItem ||
        sourceItem.location !== 'Store Center' ||
        sourceItem.status !== 'Pending Dispatch' ||
        sourceItem.purchasedForProject !== createProjectLabel(sourceProjectNo) ||
        line.qty > sourceItem.qty
      ) {
        throw new Error(`Invalid dispatch selection for ${line.receiveNo}`);
      }

      return {
        line,
        sourceItem,
      };
    });

    if (!selectedItems.length || !sourceProject || !targetProject) {
      return;
    }

    const dispatchNo = createDispatchNumber();
    const dispatchId = dispatchNo;
    const dispatchedAt = new Date().toISOString();
    const dispatchedByName = formatPersonName(
      userProfile?.firstName,
      userProfile?.lastName,
      userProfile?.email ?? 'Store Center'
    );
    const dispatchedByEmail = userProfile?.email ?? 'unknown@cmg.local';
    const photoUrls = await Promise.all(
      photos.map(async (photo, index) => {
        const storageRef = ref(
          storage,
          `dispatchRecords/${dispatchNo}/${String(index + 1).padStart(2, '0')}-${sanitizeFileName(photo.name)}`
        );
        await uploadBytes(storageRef, photo);
        return getDownloadURL(storageRef);
      })
    );

    const dispatchSnapshots = selectedItems.map(({ line, sourceItem }, index) => ({
      receiveNo: sourceItem.receiveNo,
      stockItemId:
        line.qty === sourceItem.qty
          ? getStockItemId(sourceItem)
          : createDispatchStockReceiveNo(getStockItemId(sourceItem), dispatchNo, index),
      stockReceiveNo:
        line.qty === sourceItem.qty
          ? getStockItemId(sourceItem)
          : createDispatchStockReceiveNo(getStockItemId(sourceItem), dispatchNo, index),
      prNo: sourceItem.prNo,
      poNo: sourceItem.poNo,
      itemNo: sourceItem.itemNo,
      itemDescription: sourceItem.itemDescription,
      qty: line.qty,
      vendorName: sourceItem.vendorName,
      sourceLocation: sourceItem.location,
    }));

    const record: DispatchRecord = {
      id: dispatchId,
      dispatchNo,
      sourceProjectNo: sourceProject.projectNo,
      sourceProjectName: sourceProject.projectName,
      destinationProjectNo: targetProject.projectNo,
      destinationProjectName: targetProject.projectName,
      status: 'Pending Receipt',
      itemReceiveNos: dispatchSnapshots.map((item) => item.stockReceiveNo),
      items: dispatchSnapshots,
      totalQty: dispatchSnapshots.reduce((sum, item) => sum + item.qty, 0),
      transport: transport.trim(),
      note: note.trim(),
      photoUrls,
      dispatchedAt,
      dispatchedByName,
      dispatchedByEmail,
    };

    const batch = writeBatch(db);
    selectedItems.forEach(({ line, sourceItem }, index) => {
      const sourceRef = doc(db, APP_NAME, 'root', 'stockItems', getStockItemId(sourceItem));
      const dispatchedAmount = calculatePartialAmount(sourceItem.amount, sourceItem.qty, line.qty);
      const remainingQty = sourceItem.qty - line.qty;
      const remainingAmount = roundAmount(sourceItem.amount - dispatchedAmount);

      if (remainingQty <= 0) {
        batch.update(sourceRef, {
          status: 'In Transit',
          location: createTransitLocation(projectNo),
          purchasedForProject: createProjectLabel(projectNo),
        });
        return;
      }

      batch.update(sourceRef, {
        qty: remainingQty,
        amount: remainingAmount,
        status: 'Pending Dispatch',
        location: 'Store Center',
        purchasedForProject: createProjectLabel(sourceProjectNo),
      });

      const dispatchedItemId = dispatchSnapshots[index].stockReceiveNo;
      const dispatchedItemRef = doc(db, APP_NAME, 'root', 'stockItems', dispatchedItemId);
      const dispatchedItem: StockItem = {
        ...sourceItem,
        stockItemId: dispatchedItemId,
        receiveNo: dispatchedItemId,
        qty: line.qty,
        amount: dispatchedAmount,
        location: createTransitLocation(projectNo),
        purchasedForProject: createProjectLabel(projectNo),
        status: 'In Transit',
      };

      batch.set(dispatchedItemRef, dispatchedItem);
    });

    const dispatchRef = doc(db, APP_NAME, 'root', 'dispatchRecords', dispatchId);
    batch.set(dispatchRef, record);
    await batch.commit();
  }, [items, projectList, userProfile]);

  const receiveDispatch = useCallback(async (dispatchId: string) => {
    const target = dispatchList.find((record) => record.id === dispatchId);
    if (!target || target.status === 'Received at Site') {
      return;
    }

    const receivedAt = new Date().toISOString();
    const receivedByName = formatPersonName(
      userProfile?.firstName,
      userProfile?.lastName,
      userProfile?.email ?? 'Site Receiver'
    );
    const receivedByEmail = userProfile?.email ?? 'unknown@cmg.local';

    const batch = writeBatch(db);
    target.itemReceiveNos.forEach((receiveNo) => {
      const docRef = doc(db, APP_NAME, 'root', 'stockItems', receiveNo);
      batch.update(docRef, {
        status: 'Received at Site',
        location: createProjectStoreLocation(target.destinationProjectNo),
        purchasedForProject: createProjectLabel(target.destinationProjectNo),
      });
    });

    const dispatchRef = doc(db, APP_NAME, 'root', 'dispatchRecords', dispatchId);
    batch.update(dispatchRef, {
      status: 'Received at Site',
      receivedAt,
      receivedByName,
      receivedByEmail,
    });
    await batch.commit();
  }, [dispatchList, userProfile]);

  const approveReceivingRequest = useCallback(async (requestId: string) => {
    const target = receivingRequestList.find(
      (request) => request.id === requestId && request.requestStatus === 'pending'
    );

    if (!target || !target.items.length) {
      return;
    }

    const projectNo = target.projectNo || extractProjectNo(target.projectName);
    const location = target.location || (projectNo ? createProjectStoreLocation(projectNo) : 'Store Center');
    const stockStatus: StockItem['status'] = location === 'Store Center' ? 'Pending Dispatch' : 'Received at Site';
    const approvedAt = new Date().toISOString();
    const approvedByName = formatPersonName(
      userProfile?.firstName,
      userProfile?.lastName,
      userProfile?.email ?? 'Store Receiver'
    );
    const approvedByEmail = userProfile?.email ?? 'unknown@cmg.local';
    const stockReceiveNos = target.items.map((item, index) => createReceivingStockReceiveNo(target, item, index));

    const batch = writeBatch(db);
    target.items.forEach((item, index) => {
      const stockReceiveNo = stockReceiveNos[index];
      const stockRef = doc(db, APP_NAME, 'root', 'stockItems', stockReceiveNo);
      const stockItem: StockItem = {
        stockItemId: stockReceiveNo,
        receiveNo: stockReceiveNo,
        poNo: target.poNo,
        prNo: target.prNo,
        poType: target.poType,
        itemNo: item.itemNo,
        itemDescription: item.itemDescription,
        amount: item.amount,
        qty: item.receivedQty,
        vendorName: target.vendorName,
        location,
        purchasedForProject: projectNo ? createProjectLabel(projectNo) : target.projectName,
        receiveName: target.receiveName || approvedByName,
        receiveDate: target.receiveDate,
        status: stockStatus,
      };

      batch.set(stockRef, stockItem);
    });

    const requestRef = doc(db, APP_NAME, 'root', 'receivingRequests', target.id);
    batch.set(
      requestRef,
      {
        requestStatus: 'approved',
        approvedAt,
        approvedByUid: userProfile?.uid ?? '',
        approvedByName,
        approvedByEmail,
        stockReceiveNos,
      },
      { merge: true }
    );

    await batch.commit();
  }, [receivingRequestList, userProfile]);

  const approveReceipt = useCallback(async (receiveNo: string) => {
    const pendingDispatch = dispatchList.find(
      (record) => record.status === 'Pending Receipt' && record.itemReceiveNos.includes(receiveNo)
    );

    if (pendingDispatch) {
      await receiveDispatch(pendingDispatch.id);
      return;
    }

    const docRef = doc(db, APP_NAME, 'root', 'stockItems', receiveNo);
    const target = items.find((item) => getStockItemId(item) === receiveNo);
    if (!target) return;

    const projectNo = extractProjectNo(target.purchasedForProject);

    await setDoc(
      docRef,
      {
        status: 'Received at Site',
        location: projectNo ? createProjectStoreLocation(projectNo) : target.location,
      },
      { merge: true }
    );
  }, [dispatchList, items, receiveDispatch]);

  const receiveNewItem = useCallback(async (item: StockItem) => {
    const stockItemId = getStockItemId(item);
    const docRef = doc(db, APP_NAME, 'root', 'stockItems', stockItemId);
    await setDoc(docRef, {
      ...item,
      stockItemId,
    });
  }, []);

  const receivePrPoPayload = useCallback(async (payload: PrPoReceivePayload) => {
    return processPrPoReceivePayload(payload);
  }, []);

  const updateProjectStatus = useCallback(async (projectNo: string, status: ProjectStatus) => {
    const normalizedProjectNo = projectNo.trim();
    if (!normalizedProjectNo) {
      return;
    }
    const normalizedStatus = normalizeProjectStatus(status);

    const docRef = doc(db, APP_NAME, 'root', 'projectStatuses', normalizedProjectNo);
    await setDoc(
      docRef,
      {
        projectNo: normalizedProjectNo,
        status: normalizedStatus,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  }, []);

  const value = useMemo<InventoryContextValue>(
    () => ({
      projects: visibleProjects,
      activeProjects: activeVisibleProjects,
      stockItems: items,
      receivingRequests: receivingRequestList,
      dispatchRecords: visibleDispatchRecords,
      updateProjectStatus,
      createDispatch,
      approveReceipt,
      approveReceivingRequest,
      receiveDispatch,
      receiveNewItem,
      receivePrPoPayload,
      activeProjectNo,
      setActiveProjectNo,
    }),
    [
      activeProjectNo,
      approveReceivingRequest,
      approveReceipt,
      createDispatch,
      items,
      receivingRequestList,
      receiveDispatch,
      receiveNewItem,
      receivePrPoPayload,
      updateProjectStatus,
      activeVisibleProjects,
      visibleDispatchRecords,
      visibleProjects,
    ]
  );

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          background: '#f7f5ff',
          color: '#4f2ed9',
          fontFamily: 'Inter, sans-serif',
        }}
      >
        <div
          style={{
            width: '40px',
            height: '40px',
            border: '4px solid rgb(79 46 217 / 18%)',
            borderTop: '4px solid #4f2ed9',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            marginBottom: '16px',
          }}
        />
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
        <span style={{ fontWeight: 600, fontSize: '14px', letterSpacing: '0.05em' }}>
          LOADING DATABASE...
        </span>
      </div>
    );
  }

  return (
    <InventoryContext.Provider value={value}>
      {children}
    </InventoryContext.Provider>
  );
}

export function useInventory() {
  const context = useContext(InventoryContext);
  if (!context) {
    throw new Error('useInventory must be used within InventoryProvider');
  }
  return context;
}
