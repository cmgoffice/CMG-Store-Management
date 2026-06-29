import {
  collection,
  doc,
  increment,
  runTransaction,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { APP_NAME } from '../config/firestore';
import { db } from '../firebase';
import type {
  PrPoReceiveItemPayload,
  PrPoReceiveItemResult,
  PrPoReceivePayload,
  PrPoReceiveResponse,
  PrPoReceiveResponseStatus,
} from '../types/models';

const SOURCE_APP = 'PR_PO_SYSTEM';
const ALLOWED_RECEIVE_TYPES = new Set(['material', 'eqm']);

type NormalizedReceiveItem = {
  stockItemId: string;
  eventId: string;
  itemKey: string;
  itemKeyType: 'iditem' | 'materialNo';
  iditem?: string;
  materialNo?: string;
  idempotencyKey: string;
  receivedQty: number;
  amount: number;
  unitPrice?: number;
  orderedQty?: number;
  itemDescription: string;
  itemNo: string;
  unit?: string;
  poItemIndex?: string | number;
};

function readString(value: unknown) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).trim();
}

function readNumber(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }

  const parsed = typeof value === 'number'
    ? value
    : Number(String(value).replace(/,/g, '').trim());

  return Number.isFinite(parsed) ? parsed : undefined;
}

function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item));
  }

  if (
    value &&
    typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  ) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .map(([entryKey, entryValue]) => [entryKey, stripUndefined(entryValue)]),
    );
  }

  return value;
}

function stableHash(value: string) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(36);
}

function makeDocumentId(prefix: string, value: string) {
  const normalized = value.trim().toLowerCase();
  const readable = normalized.replace(/[^a-z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 72);
  return `${prefix}_${stableHash(normalized)}_${readable || 'item'}`;
}

function makeProjectLabel(projectId: string) {
  return projectId ? `Project ${projectId}` : 'Project';
}

function normalizeReceiveType(receiveType: unknown) {
  return readString(receiveType).toLowerCase();
}

function getPayloadReceiveNo(payload: PrPoReceivePayload) {
  return readString(payload.receiveNo) || readString(payload.rpNo);
}

function getPayloadDate(payload: PrPoReceivePayload) {
  return readString(payload.receivedDate) || readString(payload.createdAt) || new Date().toISOString();
}

function getItemKey(item: PrPoReceiveItemPayload) {
  const iditem = readString(item.iditem);
  if (iditem) {
    return {
      itemKey: iditem,
      itemKeyType: 'iditem' as const,
    };
  }

  const materialNo = readString(item.materialNo);
  if (materialNo) {
    return {
      itemKey: materialNo,
      itemKeyType: 'materialNo' as const,
    };
  }

  return undefined;
}

function getIdempotencyKey(payload: PrPoReceivePayload, item: PrPoReceiveItemPayload) {
  const receiveNo = getPayloadReceiveNo(payload);
  const poItemIndex = readString(item.poItemIndex);
  const iditem = readString(item.iditem);
  const materialNo = readString(item.materialNo);

  if (poItemIndex) {
    return `${receiveNo}|poItemIndex:${poItemIndex}`;
  }

  if (iditem) {
    return `${receiveNo}|iditem:${iditem}`;
  }

  if (materialNo) {
    return `${receiveNo}|materialNo:${materialNo}`;
  }

  return '';
}

function normalizeReceiveItem(
  payload: PrPoReceivePayload,
  item: PrPoReceiveItemPayload,
): NormalizedReceiveItem | PrPoReceiveItemResult {
  const itemKey = getItemKey(item);
  if (!itemKey) {
    return {
      status: 'failed',
      message: 'Item is missing iditem and materialNo, so it cannot be upserted safely.',
    };
  }

  const idempotencyKey = getIdempotencyKey(payload, item);
  if (!idempotencyKey) {
    return {
      status: 'failed',
      message: 'Item is missing receiveNo/rpNo and item idempotency fields.',
      itemKey: itemKey.itemKey,
      itemKeyType: itemKey.itemKeyType,
    };
  }

  const receivedQty = readNumber(item.receivedQty) ?? readNumber(item.qtyReceive);
  if (!receivedQty || receivedQty <= 0) {
    return {
      status: 'failed',
      message: 'Item receivedQty/qtyReceive must be greater than zero.',
      itemKey: itemKey.itemKey,
      itemKeyType: itemKey.itemKeyType,
      idempotencyKey,
    };
  }

  const unitPrice = readNumber(item.price) ?? readNumber(item.unitPrice);
  const amount = readNumber(item.amount) ?? (unitPrice ? receivedQty * unitPrice : 0);
  const itemDescription = readString(item.description) || readString(item.itemName) || itemKey.itemKey;
  const stockItemId = makeDocumentId(`prpo_${itemKey.itemKeyType}`, itemKey.itemKey);

  return {
    stockItemId,
    eventId: makeDocumentId('prpo_event', idempotencyKey),
    itemKey: itemKey.itemKey,
    itemKeyType: itemKey.itemKeyType,
    iditem: readString(item.iditem) || undefined,
    materialNo: readString(item.materialNo) || undefined,
    idempotencyKey,
    receivedQty,
    amount,
    unitPrice,
    orderedQty: readNumber(item.orderedQty),
    itemDescription,
    itemNo: readString(item.materialNo) || readString(item.iditem) || itemKey.itemKey,
    unit: readString(item.unit) || undefined,
    poItemIndex: item.poItemIndex,
  };
}

function getStockItemForCreate(
  payload: PrPoReceivePayload,
  normalizedItem: NormalizedReceiveItem,
): Record<string, unknown> {
  const receiveType = readString(payload.receiveType);
  const projectId = readString(payload.projectId);
  const receiveNo = getPayloadReceiveNo(payload);

  return stripUndefined({
    stockItemId: normalizedItem.stockItemId,
    receiveNo,
    poNo: readString(payload.poNo),
    prNo: readString(payload.prNo),
    poType: receiveType,
    itemNo: normalizedItem.itemNo,
    itemDescription: normalizedItem.itemDescription,
    amount: normalizedItem.amount,
    qty: normalizedItem.receivedQty,
    vendorName: readString(payload.vendorName),
    location: `In Transit to ${makeProjectLabel(projectId)}`,
    purchasedForProject: makeProjectLabel(projectId),
    receiveName: readString(payload.receivedByName) || SOURCE_APP,
    receiveDate: getPayloadDate(payload),
    status: 'In Transit',
    sourceApp: readString(payload.sourceApp) || SOURCE_APP,
    sourceReceiveNo: receiveNo,
    rpNo: readString(payload.rpNo) || undefined,
    receiveType,
    iditem: normalizedItem.iditem,
    materialNo: normalizedItem.materialNo,
    unit: normalizedItem.unit,
    poItemIndex: normalizedItem.poItemIndex,
    orderedQty: normalizedItem.orderedQty,
    unitPrice: normalizedItem.unitPrice,
    projectId,
    vendorId: readString(payload.vendorId) || undefined,
    documentNo: readString(payload.documentNo) || undefined,
    poId: readString(payload.poId) || undefined,
    receivedByUid: readString(payload.receivedByUid) || undefined,
    note: readString(payload.note) || undefined,
    lastReceiveEventId: normalizedItem.eventId,
    lastReceivedQty: normalizedItem.receivedQty,
    lastReceivedAt: getPayloadDate(payload),
  }) as Record<string, unknown>;
}

async function writeReceiveLog(
  status: PrPoReceiveResponseStatus,
  payload: PrPoReceivePayload,
  message: string,
  items: PrPoReceiveItemResult[],
) {
  const logRef = doc(collection(db, APP_NAME, 'root', 'prPoReceiveLogs'));

  await setDoc(logRef, stripUndefined({
    status,
    sourceApp: readString(payload.sourceApp) || SOURCE_APP,
    receiveNo: getPayloadReceiveNo(payload),
    receiveType: readString(payload.receiveType),
    normalizedReceiveType: normalizeReceiveType(payload.receiveType),
    message,
    items,
    payload: stripUndefined(payload),
    loggedAt: serverTimestamp(),
  }) as Record<string, unknown>);
}

async function upsertReceiveItem(
  payload: PrPoReceivePayload,
  normalizedItem: NormalizedReceiveItem,
): Promise<PrPoReceiveItemResult> {
  const eventRef = doc(db, APP_NAME, 'root', 'prPoReceiveEvents', normalizedItem.eventId);
  const stockRef = doc(db, APP_NAME, 'root', 'stockItems', normalizedItem.stockItemId);
  const projectId = readString(payload.projectId);
  const receiveNo = getPayloadReceiveNo(payload);
  const receiveDate = getPayloadDate(payload);
  const receiveType = readString(payload.receiveType);

  return runTransaction(db, async (transaction) => {
    const eventSnapshot = await transaction.get(eventRef);
    if (eventSnapshot.exists()) {
      return {
        status: 'duplicate',
        message: 'Idempotency key has already been processed; qty was not incremented.',
        stockItemId: normalizedItem.stockItemId,
        itemKey: normalizedItem.itemKey,
        itemKeyType: normalizedItem.itemKeyType,
        idempotencyKey: normalizedItem.idempotencyKey,
        qtyIncrement: 0,
      };
    }

    const stockSnapshot = await transaction.get(stockRef);
    if (stockSnapshot.exists()) {
      transaction.update(stockRef, {
        qty: increment(normalizedItem.receivedQty),
        amount: increment(normalizedItem.amount),
        status: 'In Transit',
        location: `In Transit to ${makeProjectLabel(projectId)}`,
        purchasedForProject: makeProjectLabel(projectId),
        receiveNo,
        sourceReceiveNo: receiveNo,
        rpNo: readString(payload.rpNo) || null,
        poNo: readString(payload.poNo),
        prNo: readString(payload.prNo),
        poType: receiveType,
        receiveType,
        receiveName: readString(payload.receivedByName) || SOURCE_APP,
        receiveDate,
        vendorName: readString(payload.vendorName),
        itemNo: normalizedItem.itemNo,
        itemDescription: normalizedItem.itemDescription,
        iditem: normalizedItem.iditem || null,
        materialNo: normalizedItem.materialNo || null,
        vendorId: readString(payload.vendorId) || null,
        documentNo: readString(payload.documentNo) || null,
        poId: readString(payload.poId) || null,
        receivedByUid: readString(payload.receivedByUid) || null,
        note: readString(payload.note) || null,
        unit: normalizedItem.unit || null,
        poItemIndex: normalizedItem.poItemIndex ?? null,
        orderedQty: normalizedItem.orderedQty ?? null,
        unitPrice: normalizedItem.unitPrice ?? null,
        projectId,
        sourceApp: readString(payload.sourceApp) || SOURCE_APP,
        lastReceiveEventId: normalizedItem.eventId,
        lastReceivedQty: normalizedItem.receivedQty,
        lastReceivedAt: receiveDate,
      });
    } else {
      transaction.set(stockRef, getStockItemForCreate(payload, normalizedItem));
    }

    transaction.set(eventRef, stripUndefined({
      id: normalizedItem.eventId,
      idempotencyKey: normalizedItem.idempotencyKey,
      stockItemId: normalizedItem.stockItemId,
      itemKey: normalizedItem.itemKey,
      itemKeyType: normalizedItem.itemKeyType,
      iditem: normalizedItem.iditem,
      materialNo: normalizedItem.materialNo,
      poItemIndex: normalizedItem.poItemIndex,
      itemNo: normalizedItem.itemNo,
      itemDescription: normalizedItem.itemDescription,
      unit: normalizedItem.unit,
      orderedQty: normalizedItem.orderedQty,
      unitPrice: normalizedItem.unitPrice,
      receiveNo,
      rpNo: readString(payload.rpNo),
      poId: readString(payload.poId),
      poNo: readString(payload.poNo),
      prNo: readString(payload.prNo),
      projectId,
      vendorId: readString(payload.vendorId),
      vendorName: readString(payload.vendorName),
      documentNo: readString(payload.documentNo),
      receiveType,
      receivedDate: readString(payload.receivedDate),
      receivedByUid: readString(payload.receivedByUid),
      receivedByName: readString(payload.receivedByName),
      note: readString(payload.note),
      createdAt: readString(payload.createdAt),
      receivedQty: normalizedItem.receivedQty,
      amount: normalizedItem.amount,
      sourceApp: readString(payload.sourceApp) || SOURCE_APP,
      processedAt: serverTimestamp(),
    }) as Record<string, unknown>);

    return {
      status: 'success',
      message: stockSnapshot.exists()
        ? 'Existing item was updated with atomic qty increment.'
        : 'New incoming item was created.',
      stockItemId: normalizedItem.stockItemId,
      itemKey: normalizedItem.itemKey,
      itemKeyType: normalizedItem.itemKeyType,
      idempotencyKey: normalizedItem.idempotencyKey,
      qtyIncrement: normalizedItem.receivedQty,
    };
  });
}

function summarizeResponse(payload: PrPoReceivePayload, items: PrPoReceiveItemResult[]): PrPoReceiveResponse {
  const processedCount = items.filter((item) => item.status === 'success').length;
  const duplicateCount = items.filter((item) => item.status === 'duplicate').length;
  const failedCount = items.filter((item) => item.status === 'failed').length;
  const ignoredCount = items.filter((item) => item.status === 'ignored').length;

  let status: PrPoReceiveResponseStatus = 'success';
  let message = `Processed ${processedCount} item(s).`;

  if (processedCount === 0 && duplicateCount > 0 && failedCount === 0) {
    status = 'duplicate';
    message = 'All submitted item idempotency keys have already been processed.';
  } else if (processedCount === 0 && failedCount > 0 && duplicateCount === 0) {
    status = 'failed';
    message = 'No items were processed because every item failed validation.';
  } else if (failedCount > 0) {
    message = `Processed ${processedCount} item(s), skipped ${duplicateCount} duplicate(s), and found ${failedCount} failed item(s).`;
  } else if (duplicateCount > 0) {
    message = `Processed ${processedCount} item(s) and skipped ${duplicateCount} duplicate(s).`;
  }

  return {
    status,
    message,
    receiveNo: getPayloadReceiveNo(payload),
    processedCount,
    duplicateCount,
    failedCount,
    ignoredCount,
    items,
  };
}

export async function processPrPoReceivePayload(
  payload: PrPoReceivePayload,
): Promise<PrPoReceiveResponse> {
  const receiveType = normalizeReceiveType(payload.receiveType);

  if (!ALLOWED_RECEIVE_TYPES.has(receiveType)) {
    const result: PrPoReceiveResponse = {
      status: 'ignored',
      message: `Receive type "${readString(payload.receiveType) || '-'}" is not supported for Approve Incoming Items.`,
      receiveNo: getPayloadReceiveNo(payload),
      processedCount: 0,
      duplicateCount: 0,
      failedCount: 0,
      ignoredCount: payload.items?.length || 0,
      items: [],
    };

    await writeReceiveLog(result.status, payload, result.message, result.items);
    return result;
  }

  if (!getPayloadReceiveNo(payload)) {
    const result: PrPoReceiveResponse = {
      status: 'failed',
      message: 'Payload is missing receiveNo or rpNo.',
      processedCount: 0,
      duplicateCount: 0,
      failedCount: payload.items?.length || 1,
      ignoredCount: 0,
      items: [],
    };

    await writeReceiveLog(result.status, payload, result.message, result.items);
    return result;
  }

  if (!payload.items?.length) {
    const result: PrPoReceiveResponse = {
      status: 'failed',
      message: 'Payload has no items to process.',
      receiveNo: getPayloadReceiveNo(payload),
      processedCount: 0,
      duplicateCount: 0,
      failedCount: 1,
      ignoredCount: 0,
      items: [],
    };

    await writeReceiveLog(result.status, payload, result.message, result.items);
    return result;
  }

  try {
    const itemResults: PrPoReceiveItemResult[] = [];

    for (const item of payload.items) {
      const normalizedItem = normalizeReceiveItem(payload, item);

      if ('status' in normalizedItem) {
        itemResults.push(normalizedItem);
      } else {
        itemResults.push(await upsertReceiveItem(payload, normalizedItem));
      }
    }

    const response = summarizeResponse(payload, itemResults);
    await writeReceiveLog(response.status, payload, response.message, response.items);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error while processing receive payload.';
    const result: PrPoReceiveResponse = {
      status: 'failed',
      message,
      receiveNo: getPayloadReceiveNo(payload),
      processedCount: 0,
      duplicateCount: 0,
      failedCount: payload.items.length,
      ignoredCount: 0,
      items: [],
    };

    await writeReceiveLog(result.status, payload, result.message, result.items);
    return result;
  }
}
