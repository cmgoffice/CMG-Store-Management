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
  setDoc,
  writeBatch,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  dispatchRecords as mockDispatchRecords,
  projects as mockProjects,
  stockItems as mockStockItems,
} from '../data/mockData';
import type {
  DispatchRecord,
  Project,
  StockItem,
} from '../types/models';
import { useAuth } from './AuthContext';

interface CreateDispatchInput {
  receiveNos: string[];
  projectNo: string;
  transport: string;
  note: string;
  photoUrls: string[];
}

interface InventoryContextValue {
  projects: Project[];
  stockItems: StockItem[];
  dispatchRecords: DispatchRecord[];
  dispatchItems: (receiveNos: string[], projectNo: string) => Promise<void>;
  createDispatch: (input: CreateDispatchInput) => Promise<void>;
  approveReceipt: (receiveNo: string) => Promise<void>;
  receiveDispatch: (dispatchId: string) => Promise<void>;
  receiveNewItem: (item: StockItem) => Promise<void>;
  activeProjectNo: string;
  setActiveProjectNo: (projectNo: string) => void;
}

const InventoryContext = createContext<InventoryContextValue | undefined>(undefined);

const APP_NAME = 'CMG-Store-Management';

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

export function InventoryProvider({ children }: PropsWithChildren) {
  const { userProfile } = useAuth();
  const [items, setItems] = useState<StockItem[]>([]);
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [dispatchList, setDispatchList] = useState<DispatchRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeProjectNo, setActiveProjectNo] = useState<string>('');

  useEffect(() => {
    let unsubProjects = () => {};
    let unsubStock = () => {};
    let unsubDispatch = () => {};

    async function initializeDatabase() {
      try {
        const projectsCol = collection(db, APP_NAME, 'root', 'projects');
        const stockCol = collection(db, APP_NAME, 'root', 'stockItems');
        const dispatchCol = collection(db, APP_NAME, 'root', 'dispatchRecords');

        const [projectsSnapshot, stockSnapshot, dispatchSnapshot] = await Promise.all([
          getDocs(projectsCol),
          getDocs(stockCol),
          getDocs(dispatchCol),
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
      } catch (error) {
        console.error('Failed to query or seed Firestore databases on init:', error);
      }

      const projectsColRef = collection(db, APP_NAME, 'root', 'projects');
      unsubProjects = onSnapshot(
        projectsColRef,
        (snapshot) => {
          const loadedProjects = snapshot.docs.map((d) => d.data() as Project);
          loadedProjects.sort((a, b) => a.projectNo.localeCompare(b.projectNo));
          setProjectList(loadedProjects);
        },
        (error) => {
          console.error('Failed to listen to projects updates:', error);
          setProjectList(mockProjects);
        }
      );

      const stockColRef = collection(db, APP_NAME, 'root', 'stockItems');
      unsubStock = onSnapshot(
        stockColRef,
        (snapshot) => {
          const loadedItems = snapshot.docs.map((d) => d.data() as StockItem);
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
    }

    initializeDatabase();

    return () => {
      unsubProjects();
      unsubStock();
      unsubDispatch();
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
    return dispatchList.filter((record) => assigned.has(record.destinationProjectNo));
  }, [dispatchList, userProfile]);

  useEffect(() => {
    if (visibleProjects.length > 0) {
      const isValid = visibleProjects.some((p) => p.projectNo === activeProjectNo);
      if (!activeProjectNo || !isValid) {
        setActiveProjectNo(visibleProjects[0].projectNo);
      }
    } else {
      setActiveProjectNo('');
    }
  }, [visibleProjects, activeProjectNo]);

  const createDispatch = useCallback(async ({
    receiveNos,
    projectNo,
    transport,
    note,
    photoUrls,
  }: CreateDispatchInput) => {
    if (!receiveNos.length) {
      return;
    }

    const selectedItems = items.filter((item) => receiveNos.includes(item.receiveNo));
    const targetProject = projectList.find((project) => project.projectNo === projectNo);

    if (!selectedItems.length || !targetProject) {
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

    const record: DispatchRecord = {
      id: dispatchId,
      dispatchNo,
      destinationProjectNo: targetProject.projectNo,
      destinationProjectName: targetProject.projectName,
      status: 'Pending Receipt',
      itemReceiveNos: selectedItems.map((item) => item.receiveNo),
      items: selectedItems.map((item) => ({
        receiveNo: item.receiveNo,
        prNo: item.prNo,
        poNo: item.poNo,
        itemNo: item.itemNo,
        itemDescription: item.itemDescription,
        qty: item.qty,
        vendorName: item.vendorName,
        sourceLocation: item.location,
      })),
      totalQty: selectedItems.reduce((sum, item) => sum + item.qty, 0),
      transport: transport.trim(),
      note: note.trim(),
      photoUrls,
      dispatchedAt,
      dispatchedByName,
      dispatchedByEmail,
    };

    const batch = writeBatch(db);
    selectedItems.forEach((item) => {
      const docRef = doc(db, APP_NAME, 'root', 'stockItems', item.receiveNo);
      batch.update(docRef, {
        status: 'In Transit',
        location: `In Transit to Project ${projectNo}`,
        purchasedForProject: `Project ${projectNo}`,
      });
    });

    const dispatchRef = doc(db, APP_NAME, 'root', 'dispatchRecords', dispatchId);
    batch.set(dispatchRef, record);
    await batch.commit();
  }, [items, projectList, userProfile]);

  const dispatchItems = useCallback(async (receiveNos: string[], projectNo: string) => {
    await createDispatch({
      receiveNos,
      projectNo,
      transport: '',
      note: '',
      photoUrls: [],
    });
  }, [createDispatch]);

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
        location: `Project ${target.destinationProjectNo}`,
        purchasedForProject: `Project ${target.destinationProjectNo}`,
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

  const approveReceipt = useCallback(async (receiveNo: string) => {
    const pendingDispatch = dispatchList.find(
      (record) => record.status === 'Pending Receipt' && record.itemReceiveNos.includes(receiveNo)
    );

    if (pendingDispatch) {
      await receiveDispatch(pendingDispatch.id);
      return;
    }

    const docRef = doc(db, APP_NAME, 'root', 'stockItems', receiveNo);
    const target = items.find((item) => item.receiveNo === receiveNo);
    if (!target) return;

    await setDoc(
      docRef,
      {
        status: 'Received at Site',
        location: target.purchasedForProject,
      },
      { merge: true }
    );
  }, [dispatchList, items, receiveDispatch]);

  const receiveNewItem = useCallback(async (item: StockItem) => {
    const docRef = doc(db, APP_NAME, 'root', 'stockItems', item.receiveNo);
    await setDoc(docRef, item);
  }, []);

  const value = useMemo<InventoryContextValue>(
    () => ({
      projects: visibleProjects,
      stockItems: items,
      dispatchRecords: visibleDispatchRecords,
      dispatchItems,
      createDispatch,
      approveReceipt,
      receiveDispatch,
      receiveNewItem,
      activeProjectNo,
      setActiveProjectNo,
    }),
    [
      activeProjectNo,
      approveReceipt,
      createDispatch,
      dispatchItems,
      items,
      receiveDispatch,
      receiveNewItem,
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
