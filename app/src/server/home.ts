import type { Hono } from 'hono';
import type { Paths } from '../config';
import type { Db } from '../db/open';
import { addVendor, deleteVendor, HomeError, updateProject, updateVendor } from '../home';
import { homeProject, PAYER_LABELS } from '../reports/home';
import { homeCsv, writeHomeCsv } from '../reports/homeCsv';
import { thresholdsOrDefault } from '../benchmarks';
import { loadSettings } from '../settings';
import { sgtDate } from '../core/dates';

type Serial = <T>(task: () => Promise<T>) => Promise<T>;

async function body(req: Request): Promise<Record<string, unknown>> {
  const b: unknown = await req.json().catch(() => null);
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
}

/** The Home project screen: the report, project and vendor edits, and the CSV export. */
export function registerHomeRoutes(api: Hono, paths: Paths, db: () => Db, serial: Serial): void {
  const data = () => {
    const settings = loadSettings(paths);
    return homeProject(db(), settings, { largeUnsortedCents: thresholdsOrDefault(paths).largeUnsortedCents });
  };

  api.get('/home', (c) => c.json(data()));

  const guarded = async (c: { json: (b: unknown, s?: number) => Response }, task: () => unknown) => {
    try {
      return c.json(await serial(async () => task()));
    } catch (e) {
      if (e instanceof HomeError) return c.json({ error: e.message }, 400);
      throw e;
    }
  };

  api.patch('/home/project', async (c) => {
    const b = await body(c.req.raw);
    return guarded(c, () => ({ project: updateProject(db(), b) }));
  });
  api.post('/home/vendors', async (c) => {
    const b = await body(c.req.raw);
    return guarded(c, () => ({ id: addVendor(db(), b) }));
  });
  api.patch('/home/vendors/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'That is not a vendor number.' }, 400);
    const b = await body(c.req.raw);
    const ok = await serial(async () => {
      try {
        return updateVendor(db(), id, b);
      } catch (e) {
        if (e instanceof HomeError) return e;
        throw e;
      }
    });
    if (ok instanceof HomeError) return c.json({ error: ok.message }, 400);
    return ok ? c.json({ ok: true }) : c.json({ error: 'That vendor is not here any more.' }, 404);
  });
  api.delete('/home/vendors/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'That is not a vendor number.' }, 400);
    const ok = await serial(async () => deleteVendor(db(), id));
    return ok ? c.json({ ok: true }) : c.json({ error: 'That vendor is not here any more.' }, 404);
  });

  // A POST, so only this app can ask for it (the origin check covers writes). The export is
  // written to outputs/exports and returned as a download of the same bytes. If the file is open
  // in Excel (Windows locks it), the download still works and says the copy was not saved.
  api.post('/home/export.csv', async (c) => {
    const settings = loadSettings(paths);
    const today = sgtDate(new Date().toISOString());
    const csv = homeCsv(data(), (p) => PAYER_LABELS(settings.partner.name)[p]);
    let saved = 'yes';
    try {
      await serial(async () => writeHomeCsv(paths, csv, today));
    } catch {
      saved = 'no';
    }
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="home-project-${today}.csv"`,
        'x-tally-saved': saved,
        'cache-control': 'no-store',
      },
    });
  });
}
