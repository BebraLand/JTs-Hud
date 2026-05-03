const query = new URLSearchParams(window.location.search)
export const port = Number(query.get('port') || 1349)
export const API_URL = `http://localhost:${port}/api`
