import { SearchField } from '../components/SearchField';
import { useInventory } from '../context/InventoryContext';
import { PageHeader } from '../components/PageHeader';
import { useMemo, useState } from 'react';
import '../styles/tables.css';
import styles from './ProjectListPage.module.css';

export function ProjectListPage() {
  const { projects, stockItems } = useInventory();
  const [query, setQuery] = useState('');

  const filteredProjects = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return projects;
    }

    return projects.filter((project) =>
      [
        project.projectNo,
        project.projectName,
        project.location,
        project.projectManager,
        project.constructionManager,
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalized),
    );
  }, [projects, query]);

  return (
    <div>
      <PageHeader
        eyebrow="Project"
        title="Project List"
        description="Active project sites used by the dispatch and receiving workflows."
        actions={
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search projects"
          />
        }
      />

      <div className="tableScroll">
        <table className="table">
          <thead>
            <tr>
              <th>Project No.</th>
              <th>Project Name</th>
              <th>Location</th>
              <th>Project Manager</th>
              <th>Construction Manager</th>
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
                  <td>
                    <strong className={styles.projectNo}>{project.projectNo}</strong>
                  </td>
                  <td>{project.projectName}</td>
                  <td>{project.location}</td>
                  <td>{project.projectManager}</td>
                  <td>{project.constructionManager}</td>
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
