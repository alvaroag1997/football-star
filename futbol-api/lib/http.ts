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
