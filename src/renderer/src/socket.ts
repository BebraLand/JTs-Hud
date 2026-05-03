import { io } from 'socket.io-client';
import { port } from './index';

// Shared socket connection for the Electron renderer / admin UI
export const socket = io(`http://localhost:${port}`, {
  autoConnect: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
});
