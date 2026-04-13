export const sortSidebarProjects = <T extends { projectId: string }>(
  projects: T[],
  activeProjectId: string | null
) => {
  const alphabeticalProjects = [...projects].sort((left, right) =>
    left.projectId.localeCompare(right.projectId)
  )

  if (!activeProjectId) {
    return alphabeticalProjects
  }

  const activeIndex = alphabeticalProjects.findIndex(project => project.projectId === activeProjectId)
  if (activeIndex < 0) {
    return alphabeticalProjects
  }

  const [activeProject] = alphabeticalProjects.splice(activeIndex, 1)
  return [activeProject, ...alphabeticalProjects]
}
