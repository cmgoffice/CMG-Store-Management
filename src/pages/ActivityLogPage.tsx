import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, Timestamp } from 'firebase/firestore';
import { History } from 'lucide-react';
import { db } from '../firebase';
import { APP_NAME } from '../config/firestore';
import { PageHeader } from '../components/PageHeader';
import { SearchField } from '../components/SearchField';
import '../styles/tables.css';

interface ActivityLog {
  id: string;
  action?: string;
  email?: string;
  timestamp?: unknown;
  details?: Record<string, unknown>;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Timestamp) {
    return value.toDate();
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    const candidate = value as { toDate?: unknown };
    if (typeof candidate.toDate === 'function') {
      return candidate.toDate() as Date;
    }
  }
  return null;
}

function formatTimestamp(value: unknown) {
  const date = toDate(value);
  if (!date) {
    return 'รอดำเนินการ';
  }

  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'Asia/Bangkok',
  }).format(date);
}

function getTimestampMillis(value: unknown) {
  return toDate(value)?.getTime() ?? 0;
}

const actionLabels: Record<string, string> = {
  LOGIN: 'เข้าสู่ระบบ',
  REGISTER: 'สมัครสมาชิก',
  DISPATCH: 'ส่งของ',
  RECEIVE: 'รับเข้า',
  RECEIVE_TRANSFER: 'รับเข้าจากการย้าย',
  RECEIVE_IMPORT: 'เพิ่มรายการรับเข้า',
  WITHDRAW: 'เบิกสินค้า',
  RECEIVE_RETURN: 'รับคืนสินค้า',
  TRANSFER_REQUEST: 'ขอย้าย / ยืมระหว่างโครงการ',
  TRANSFER_APPROVE: 'อนุมัติการย้าย / ยืม',
  TRANSFER_REJECT: 'ปฏิเสธการย้าย / ยืม',
  TRANSFER_RETURN_REQUEST: 'แจ้งคืนสินค้าระหว่างโครงการ',
  TRANSFER_RETURN: 'รับคืนสินค้าระหว่างโครงการ',
  CANCEL: 'ขอยกเลิก / ยกเลิกคำขอ',
  DELETE_ITEM: 'ลบรายการ',
  ADD_ITEM: 'เพิ่มรายการ',
  EDIT_ITEM: 'แก้ไขรายการ',
  EDIT_PROJECT_STATUS: 'แก้ไขสถานะโครงการ',
};

function getActionLabel(action?: string) {
  return action ? actionLabels[action] ?? action : '-';
}

export function ActivityLogPage() {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const logsRef = collection(db, APP_NAME, 'root', 'activityLogs');
    const unsubscribe = onSnapshot(
      logsRef,
      (snapshot) => {
        const loadedLogs = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        })) as ActivityLog[];
        loadedLogs.sort((a, b) => getTimestampMillis(b.timestamp) - getTimestampMillis(a.timestamp));
        setLogs(loadedLogs);
        setLoading(false);
        setError(false);
      },
      (snapshotError) => {
        console.error('Failed to listen to activity logs:', snapshotError);
        setLoading(false);
        setError(true);
      }
    );

    return () => unsubscribe();
  }, []);

  const filteredLogs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return logs;
    }

    return logs.filter((log) =>
      [log.action, log.email, JSON.stringify(log.details ?? {})]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery)
    );
  }, [logs, query]);

  return (
    <div className="p-1 font-sans">
      <PageHeader
        eyebrow="System Security"
        title="ประวัติกิจกรรม"
        description="ตรวจสอบประวัติการเข้าสู่ระบบและกิจกรรมสำคัญของผู้ใช้งาน"
        actions={
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="ค้นหาจากการกระทำหรืออีเมล..."
          />
        }
      />

      {error ? (
        <div className="rounded-xl bg-white p-6 text-sm text-[#ba1a1a]">
          ไม่สามารถโหลดประวัติกิจกรรมได้ กรุณาตรวจสอบสิทธิ์การเข้าถึงแล้วลองใหม่อีกครั้ง
        </div>
      ) : loading ? (
        <div className="flex min-h-[260px] items-center justify-center text-sm font-semibold text-[#4f2ed9]">
          กำลังโหลดประวัติกิจกรรม...
        </div>
      ) : (
        <div className="tableScroll">
          <table className="table compact">
            <thead>
              <tr>
                <th>การกระทำ</th>
                <th>ผู้ใช้งาน</th>
                <th>วันและเวลา</th>
                <th>รายละเอียด</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.length > 0 ? filteredLogs.map((log) => (
                <tr key={log.id}>
                  <td>
                    <span className="inline-flex items-center gap-2 font-semibold text-[#4f2ed9]">
                      <History size={14} />
                      {getActionLabel(log.action)}
                    </span>
                  </td>
                  <td>{log.email ?? '-'}</td>
                  <td>{formatTimestamp(log.timestamp)}</td>
                  <td className="max-w-[360px] truncate text-xs text-[#686276]">
                    {Object.keys(log.details ?? {}).length > 0 ? JSON.stringify(log.details) : '-'}
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={4} className="text-center text-sm text-[#686276]">
                    ไม่พบประวัติกิจกรรม
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
