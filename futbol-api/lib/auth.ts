import { HttpError } from './http';

/**
 * Autenticación mínima para la v1.2: una clave de administrador en la cabecera
 * x-api-key. Devuelve el id del admin. Más adelante se puede sustituir por
 * Supabase Auth sin tocar los endpoints (solo esta función).
 */
export function requireAdmin(req: Request): string {
  const key = req.headers.get('x-api-key');
  if (!process.env.ADMIN_API_KEY || key !== process.env.ADMIN_API_KEY) {
    throw new HttpError(401, 'No autorizado');
  }
  const id = process.env.ADMIN_ID;
  if (!id) throw new HttpError(500, 'Falta la variable ADMIN_ID');
  return id;
}

export function requireCron(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    throw new HttpError(401, 'No autorizado');
  }
}
