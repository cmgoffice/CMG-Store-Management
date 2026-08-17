import { Bell, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useInventory } from '../context/InventoryContext';
import type { PendingTask } from '../hooks/usePendingTasks';
import styles from './PendingTasksModal.module.css';

interface PendingTasksModalProps {
  tasks: PendingTask[];
  onClose: () => void;
  onDismissToday: () => void;
}

export function PendingTasksModal({ tasks, onClose, onDismissToday }: PendingTasksModalProps) {
  const navigate = useNavigate();
  const { setActiveProjectNo } = useInventory();

  const handleTaskClick = (task: PendingTask) => {
    if (task.projectNo) {
      setActiveProjectNo(task.projectNo);
    }
    onClose();
    navigate(task.route);
  };

  return (
    <div className={styles.overlay} role="presentation">
      <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="pending-task-title">
        <div className={styles.header}>
          <div className={styles.titleWrap}>
            <div className={styles.icon}><Bell size={20} /></div>
            <div>
              <h2 id="pending-task-title">มีรายการรอดำเนินการ</h2>
              <p>พบ {tasks.length} รายการที่คุณมีสิทธิ์ดำเนินการ</p>
            </div>
          </div>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="ปิดแจ้งเตือน">
            <X size={18} />
          </button>
        </div>

        <div className={styles.list}>
          {tasks.map((task) => (
            <button key={task.id} type="button" className={styles.task} onClick={() => handleTaskClick(task)}>
              <span className={styles.taskDot} />
              <span className={styles.taskText}>
                <strong>{task.title}</strong>
                <small>{task.description}</small>
              </span>
              <span className={styles.taskArrow}>ไปที่รายการ</span>
            </button>
          ))}
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.dismissButton} onClick={onDismissToday}>
            ไม่แสดงอีกของวันนี้
          </button>
          <button type="button" className={styles.closeTextButton} onClick={onClose}>
            ปิด
          </button>
        </div>
      </section>
    </div>
  );
}
