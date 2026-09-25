import pg from 'pg';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
  const { default: app } = await import('../../artifacts/api-server/dist/app.mjs');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, route, cookie, body) => {
    const response = await fetch(origin + route, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0], body: response.status === 204 ? null : await response.json() };
  };
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const health = await request('GET', '/api/healthz');
  assert(health.status === 200, 'Health readiness failed');
  const guest = await request('POST', '/api/auth/guest');
  assert(guest.status === 200 && guest.body.user.role === 'GUEST', 'Guest login failed');
  const stats = await request('GET', '/api/dashboard/stats', guest.cookie);
  assert(stats.status === 200 && stats.body.totalProjects === 23, 'Dashboard seeded count mismatch');
  assert(stats.body.verificationRequired === stats.body.highRisk + stats.body.criticalRisk, 'Review subset mismatch');
  assert(stats.body.flaggedProjects[0]?.id === 'P-1089', 'Dashboard attention list is not priority ordered');
  const queue = await request('GET', '/api/projects?page=1&pageSize=50', guest.cookie);
  assert(queue.status === 200 && queue.body.total === stats.body.totalProjects, 'Queue count mismatch');
  const hero = await request('GET', '/api/projects/P-1089', guest.cookie);
  assert(hero.status === 200 && hero.body.analysis.risk.priority === 'CRITICAL', 'Hero priority is not CRITICAL');
  const { analysis } = hero.body;
  assert(['financial', 'visual', 'text', 'geo', 'temporal'].every((key) => analysis[key]), 'Hero lens missing');
  assert(['financial', 'visual', 'text', 'geo', 'temporal'].every((key) => analysis[key].score > 0), 'Hero evidence does not activate all five lenses');
  assert(analysis.visual.crossProjectMatch?.matchedProjectId === 'P-3022', 'Expected cross-project image match missing');
  assert(analysis.text.peerGroup.topMatches[0]?.projectId === 'P-3022', 'Expected text comparison missing');
  assert(analysis.geo.medianDistanceMeters > 1000, 'Hero GPS mismatch missing');
  assert(analysis.inconsistencies.items.length > 0 && analysis.risk.why.length > 0, 'Hero explanation missing');
  const guestWrite = await request('POST', '/api/projects/P-1089/investigation', guest.cookie, { status: 'Needs Field Visit', notes: 'Audit probe', decision: '' });
  assert(guestWrite.status === 403, 'Guest mutation was not forbidden');
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const images = await db.query("SELECT original_filename, sha256 FROM worktruth_evidence_images WHERE source = 'seed_demo_static'");
  for (const image of images.rows) {
    const bytes = await readFile(path.join(repo, 'artifacts/worktruth/public/evidence', image.original_filename));
    assert(createHash('sha256').update(bytes).digest('hex') === image.sha256, `Static asset hash mismatch: ${image.original_filename}`);
  }
  await db.end();
  let officerFlow = 'unavailable: no configured officer credentials';
  if (process.env.SEED_OFFICER_EMAIL && process.env.SEED_OFFICER_PASSWORD) {
    const officer = await request('POST', '/api/auth/login', null, { email: process.env.SEED_OFFICER_EMAIL, password: process.env.SEED_OFFICER_PASSWORD });
    assert(officer.status === 200 && officer.body.user.role === 'OFFICER', 'Officer login failed');
    const update = await request('POST', '/api/projects/P-1089/investigation', officer.cookie, { status: 'Needs Field Visit', notes: 'Release audit review note', decision: 'Pending field verification' });
    assert(update.status === 200, 'Officer review update failed');
    const history = await request('GET', '/api/projects/P-1089/investigation', officer.cookie);
    assert(history.status === 200 && history.body.history.length > 0, 'Audit history missing');
    const logout = await request('POST', '/api/auth/logout', officer.cookie);
    assert(logout.status === 204, 'Logout failed');
    const afterLogout = await request('GET', '/api/projects/P-1089', officer.cookie);
    assert(afterLogout.status === 401, 'Session survived logout');
    officerFlow = 'passed';
  }
  console.log(JSON.stringify({ projects: stats.body.totalProjects, queue: queue.body.total, high: stats.body.highRisk, critical: stats.body.criticalRisk, reviewRequired: stats.body.verificationRequired, heroPriority: analysis.risk.priority, heroLensScores: Object.fromEntries(['financial', 'visual', 'text', 'geo', 'temporal'].map(key => [key, analysis[key].score])), fusedSignal: analysis.fusion.overallEvidenceScore, confidence: analysis.fusion.overallConfidence, crossEvidenceFindings: analysis.inconsistencies.items.length, heroStaticImages: images.rows.length, guestWrite: guestWrite.status, officerFlow }));
await new Promise((resolve) => server.close(resolve));
process.exit(0);
