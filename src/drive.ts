// Ingestão da fatura via Google Drive (fallback ao anexo do WhatsApp, cujo
// downloadMedia quebra com erro 'r' — módulo interno do WhatsApp Web).
// O usuário sobe o CSV numa pasta compartilhada com a service account; o bot
// lista e baixa via Drive REST usando a mesma credencial das planilhas.
import { GoogleAuth } from 'google-auth-library';
import { config } from './config';

const SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];

let auth: GoogleAuth | null = null;
function getAuth(): GoogleAuth {
  if (!auth) auth = new GoogleAuth({ keyFile: config.credentialsPath, scopes: SCOPES });
  return auth;
}

export interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
}

// Lista CSV/OFX da pasta, do mais novo pro mais antigo.
export async function listCsvs(folderId: string): Promise<DriveFile[]> {
  const client = await getAuth().getClient();
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const url =
    `https://www.googleapis.com/drive/v3/files?q=${q}` +
    `&orderBy=modifiedTime desc&pageSize=25` +
    `&fields=files(id,name,modifiedTime)` +
    `&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const res = await client.request<{ files?: DriveFile[] }>({ url });
  const files = res.data.files ?? [];
  return files.filter((f) => {
    const n = (f.name ?? '').toLowerCase();
    return n.endsWith('.csv') || n.endsWith('.ofx');
  });
}

// Baixa o conteúdo textual de um arquivo do Drive.
export async function downloadFile(fileId: string): Promise<string> {
  const client = await getAuth().getClient();
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;
  const res = await client.request({ url, responseType: 'text' });
  return String(res.data);
}
