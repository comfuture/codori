export const sortSidebarProjects = <T extends { projectId: string, projectName?: string }>(
  projects: T[],
  activeProjectId: string | null
) => {
  const alphabeticalProjects = [...projects].sort((left, right) =>
    (left.projectName ?? left.projectId).localeCompare(right.projectName ?? right.projectId)
  )

  if (!activeProjectId) {
    return alphabeticalProjects
  }

  const activeIndex = alphabeticalProjects.findIndex(project => project.projectId === activeProjectId)
  if (activeIndex < 0) {
    return alphabeticalProjects
  }

  const [activeProject] = alphabeticalProjects.splice(activeIndex, 1)
  if (!activeProject) {
    return alphabeticalProjects
  }

  return [activeProject, ...alphabeticalProjects]
}
