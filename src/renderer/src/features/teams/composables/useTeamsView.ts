import { ref, computed, onMounted } from 'vue'
import { useTeams } from './useTeams'
import { useTeamExcel } from '../../../composables/useExcel'

const TABLE_HEADERS = [
  { key: 'logo', label: 'Logo' },
  { key: 'name', label: 'Team Name', sortable: true },
  { key: 'shortName', label: 'Abbreviation', sortable: true },
  { key: 'country', label: 'Country', sortable: true }
]

const getEmptyForm = () => ({ name: '', shortName: '', country: '', logo: '', extra: {} })

export function useTeamsView() {
  const { teams, isLoading, fetchTeams, saveTeam, deleteTeam, deleteManyTeams } = useTeams()
  const { exportTeams, importTeams } = useTeamExcel(fetchTeams)

  // --- Sort ---
  const sortKey = ref('name')
  const sortDir = ref<'asc' | 'desc'>('asc')

  const handleSort = ({ key, dir }: { key: string; dir: 'asc' | 'desc' }) => {
    sortKey.value = key
    sortDir.value = dir
  }

  const sortedTeams = computed(() => {
    const list = [...teams.value]
    const dir = sortDir.value === 'asc' ? 1 : -1
    return list.sort((a, b) => {
      const aVal = (a[sortKey.value] ?? '').toLowerCase()
      const bVal = (b[sortKey.value] ?? '').toLowerCase()
      return aVal < bVal ? -dir : aVal > bVal ? dir : 0
    })
  })

  // --- Selection ---
  const selectedTeamIds = ref<string[]>([])

  const handleSelectionChange = (ids: string[]) => {
    selectedTeamIds.value = ids
  }

  const handleDeleteSelected = async () => {
    await deleteManyTeams(selectedTeamIds.value)
    selectedTeamIds.value = []
  }

  const handleDeleteAll = async () => {
    await deleteManyTeams(teams.value.map((t) => t._id))
    selectedTeamIds.value = []
  }

  // --- Modal ---
  const isModalOpen = ref(false)
  const isEditing = ref(false)
  const editingId = ref<string | null>(null)
  const formData = ref(getEmptyForm())

  const handleSave = async (payload: any, file: File | null) => {
    await saveTeam(payload, isEditing.value ? editingId.value : null, file)
    isModalOpen.value = false
  }

  const openCreateModal = () => {
    isEditing.value = false
    editingId.value = null
    formData.value = getEmptyForm()
    isModalOpen.value = true
  }

  const openEditModal = (team: any) => {
    isEditing.value = true
    editingId.value = team._id
    formData.value = { ...team }
    isModalOpen.value = true
  }

  onMounted(fetchTeams)

  return {
    // Data
    teams,
    isLoading,
    sortedTeams,
    tableHeaders: TABLE_HEADERS,
    // Sort
    sortKey,
    sortDir,
    handleSort,
    // Selection
    selectedTeamIds,
    handleSelectionChange,
    handleDeleteSelected,
    handleDeleteAll,
    // Modal
    isModalOpen,
    isEditing,
    formData,
    handleSave,
    openCreateModal,
    openEditModal,
    // Excel
    exportTeams,
    importTeams,
    // CRUD
    deleteTeam
  }
}
