export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Envuelve un handler: convierte HttpError y errores de Postgres en respuestas JSON. */
export function handle(fn: (req: Request, ctx: any) => Promise<Response>) {
  return async (req: Request, ctx: any): Promise<Response> => {
    try {
      return await fn(req, ctx);
    } catch (e: any) {
      if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
      if (e?.code === '22P02') return Response.json({ error: 'Identificador o valor con formato inválido' }, { status: 400 });
      if (e?.code === '23505') return Response.json({ error: 'Ya existe un registro igual' }, { status: 409 });
      if (e?.code === '22023') {
        const txt: Record<string, string> = {
          'scheduled_at must be in the future': 'La fecha del partido debe ser posterior al momento actual',
          'match_at must be in the future': 'La fecha de la encuesta debe ser posterior al momento actual',
          merge_same_player: 'No puedes unir un jugador consigo mismo',
        };
        return Response.json({ error: txt[e.message] ?? 'Datos no válidos' }, { status: 400 });
      }
      console.error(e);
      return Response.json({ error: 'Error interno' }, { status: 500 });
    }
  };
}

export async function readBody(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, 'El cuerpo debe ser JSON válido');
  }
}
