import { SearchField } from '../components/SearchField';
import { useInventory } from '../context/InventoryContext';
import { useRole } from '../context/RoleContext';
import { PageHeader } from '../components/PageHeader';
import { useMemo, useState } from 'react';
import '../styles/tables.css';
import styles from './ProjectListPage.module.css';
import type { ProjectStatus } from '../types/models';

export function ProjectListPage() {
  const { projects, stockItems, updateProjectStatus } = useInventory();
  const { isReadOnly } = useRole();
  const [query, setQuery] = useState('');
  const [draftStatuses, setDraftStatuses] = useState<Record<string, ProjectStatus>>({});
  const [savingProjectNo, setSavingProjectNo] = useState<string | null>(null);

  const filteredProjects = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const matchedProjects = !normalized
      ? projects
      : projects.filter((project) =>
          [
            project.projectId,
            project.projectNo,
            project.projectName,
            project.location,
            project.projectManager,
            project.constructionManager,
            project.status,
            project.source,
          ]
            .join(' ')
            .toLowerCase()
            .includes(normalized),
        );

    return [...matchedProjects].sort((left, right) => {
      const leftOrder = (left.status ?? 'Active') === 'Disactive' ? 1 : 0;
      const rightOrder = (right.status ?? 'Active') === 'Disactive' ? 1 : 0;

      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }

      return left.projectNo.localeCompare(right.projectNo);
    });
  }, [projects, query]);

  async function saveStatus(projectNo: string, nextValue?: ProjectStatus) {
    const currentProject = projects.find((project) => project.projectNo === projectNo);
    if (!currentProject) {
      return;
    }

    const nextStatus = nextValue ?? draftStatuses[projectNo] ?? currentProject.status ?? 'Active';
    const currentStatus = currentProject.status ?? 'Active';

    if (nextStatus === currentStatus) {
      return;
    }

    setSavingProjectNo(projectNo);
    try {
      await updateProjectStatus(projectNo, nextStatus);
      setDraftStatuses((prev) => ({
        ...prev,
        [projectNo]: nextStatus,
      }));
    } catch (error) {
      console.error(`Failed to update project status for ${projectNo}:`, error);
    } finally {
      setSavingProjectNo((prev) => (prev === projectNo ? null : prev));
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="โครงการ"
        title="รายการโครงการ"
        description="โครงการอาจมาจากข้อมูลในระบบหรือ MasterData สามารถแก้ไขสถานะได้ในระบบนี้ ส่วนข้อมูลที่ซิงก์จาก MasterData จะเป็นแบบอ่านอย่างเดียว"
        actions={
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="ค้นหาโครงการ"
          />
        }
      />

      <div className="tableScroll">
        <table className="table compact">
          <thead>
            <tr>
              <th>รหัสโครงการ</th><th>เลขที่โครงการ</th><th>ชื่อโครงการ</th><th>สถานที่</th><th>ผู้จัดการโครงการ</th><th>ผู้จัดการก่อสร้าง</th><th>สถานะ</th><th>แหล่งข้อมูล</th><th className="numeric">รายการสินค้า</th>
            </tr>
          </thead>
          <tbody>
            {filteredProjects.map((project) => {
              const inventoryCount = stockItems.filter((item) =>
                item.purchasedForProject.includes(project.projectNo),
              ).length;

              return (
                <tr key={project.projectNo}>
                  <td>{project.projectId ?? project.projectNo}</td>
                  <td>
                    <strong className={styles.projectNo}>{project.projectNo}</strong>
                  </td>
                  <td>{project.projectName}</td>
                  <td>{project.location}</td>
                  <td>{project.projectManager}</td>
                  <td>{project.constructionManager}</td>
                  <td>
                    <div className={styles.statusCell}>
                      <select
                        className={`${styles.statusInput} ${
                          (draftStatuses[project.projectNo] ?? project.status ?? 'Active') === 'Active'
                            ? styles.statusActive
                            : styles.statusDisactive
                        }`}
                        value={draftStatuses[project.projectNo] ?? project.status ?? 'Active'}
                        onChange={(event) => {
                          const value = event.target.value as ProjectStatus;
                          setDraftStatuses((prev) => ({
                            ...prev,
                            [project.projectNo]: value,
                          }));
                          void saveStatus(project.projectNo, value);
                        }}
                        disabled={isReadOnly || savingProjectNo === project.projectNo}
                      >
                        <option value="Active">ใช้งาน</option>
                        <option value="Disactive">ปิดใช้งาน</option>
                      </select>
                      {savingProjectNo === project.projectNo ? (
                        <span className={styles.statusMeta}>กำลังบันทึก...</span>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <span
                      className={
                        project.source === 'master'
                          ? `${styles.sourceBadge} ${styles.masterBadge}`
                          : `${styles.sourceBadge} ${styles.localBadge}`
                      }
                    >
                      {project.source === 'master' ? 'ข้อมูลหลัก' : 'ข้อมูลจากระบบ'}
                    </span>
                  </td>
                  <td className="numeric">{inventoryCount}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
