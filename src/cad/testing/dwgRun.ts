/// <reference types="node" />
/**
 * Doğruluk ölçümünde DWG: dosya, uygulamanın kullandığı istemciyle (convertDwgRemote) dönüştürme
 * servisine (services/cad-worker) gönderilir, dönen DXF uygulamadaki DXF akışıyla analiz edilir.
 * Servis adresi CAD_WORKER_URL ile verilir (ör. yerelde çalışan servis: http://127.0.0.1:8090);
 * oturum belirteci gerekiyorsa CAD_WORKER_TOKEN. Dosya yalnız bu adrese gönderilir.
 */
import { convertDwgRemote } from '../dwgService'
import { analyzeDxfFileBytes } from './dxfRun'

export const DWG_SERVICE = process.env.CAD_WORKER_URL?.replace(/\/+$/, '') || null

export async function analyzeDwgFileBytes(bytes: Uint8Array, fileName: string) {
  if (!DWG_SERVICE) throw new Error('CAD_WORKER_URL ayarlı değil: DWG ölçümü için dönüştürme servisi gerekir.')
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const conv = await convertDwgRemote(buf, fileName, process.env.CAD_WORKER_TOKEN ?? 'yerel', { baseUrl: DWG_SERVICE })
  return { ...analyzeDxfFileBytes(conv.dxf), conversion: { status: conv.quality.status, lost: conv.quality.lost, notes: conv.quality.notes, seconds: conv.seconds } }
}
