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
        eyebrow="Project"
        title="Project List"
        description="Projects can come from app data or MasterData. Status stays editable in this app, while synced MasterData fields remain read-only."
        actions={
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search projects"
          />
        }
      />

      <div className="tableScroll">
        <table className="table compact">
          <thead>
            <tr>
              <th>Project ID</th>
              <th>Project No.</th>
              <th>Project Name</th>
              <th>Location</th>
              <th>Project Manager</th>
              <th>Construction Manager</th>
              <th>Status</th>
              <th>Source</th>
              <th className="numeric">Inventory Lines</th>
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
                        <option value="Active">Active</option>
                        <option value="Disactive">Disactive</option>
                      </select>
                      {savingProjectNo === project.projectNo ? (
                        <span className={styles.statusMeta}>Saving...</span>
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
                      {project.source === 'master' ? 'MasterData' : 'App Data'}
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
