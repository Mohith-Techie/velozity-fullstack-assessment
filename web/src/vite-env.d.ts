/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Socket.IO server URL. Unset = same origin (development, through the Vite proxy). */
  readonly VITE_SOCKET_URL?: string;
}
