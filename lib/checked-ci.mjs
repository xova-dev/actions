import { execFileSync } from 'node:child_process'
import { setTimeout } from 'node:timers/promises'

function githubAPI(path, paginated = false) {
  return JSON.parse(execFileSync('gh', ['api', path, ...(paginated ? ['--paginate', '--slurp'] : [])], {
    encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  }))
}

export async function checkedCI(env, { api = githubAPI, now = Date.now, sleep = setTimeout } = {}) {
  const sha = env.EXPECTED_SHA
  const workflow = env.CI_WORKFLOW
  const config = env.CONFIG_FILE
  if (!/^[0-9a-f]{40}$/.test(sha || '') || env.GITHUB_SHA !== sha
    || !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPOSITORY || '')
    || !/^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/.test(workflow || '')
    || !config?.trim() || /[\r\n\0]/.test(config) || config.split('/').some(part => ['', '.', '..'].includes(part))
    || !/^\d+$/.test(env.CI_WAIT_SECONDS || '') || Number(env.CI_WAIT_SECONDS) > 1800)
    throw Object.assign(new Error('Exact native SHA, repository, workflow/config paths and a wait of 0–1800 seconds are required.'), { code: 'INVALID_CI_INPUT' })
  const fallback = (reason, warning = false) => {
    console.log((warning ? '::warning::' : '') + reason + ' Complete source checks are required.')
    return { 'source-sha': '', 'run-id': '' }
  }
  const base = 'repos/' + env.GITHUB_REPOSITORY + '/actions/'
  // The marker is the successful final source guard, not a claim made before tests.
  const marker = 'Full code checks (' + config + ') at ' + sha
  const deadline = now() + Number(env.CI_WAIT_SECONDS) * 1000
  const sameSource = run => run.head_sha === sha && run.path === workflow
    && run.repository?.full_name === env.GITHUB_REPOSITORY && run.head_repository?.full_name === env.GITHUB_REPOSITORY
    && ['push', 'workflow_dispatch'].includes(run.event) && String(run.id) !== env.GITHUB_RUN_ID
    && Number.isSafeInteger(run.id) && run.id > 0 && Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0
  const list = (path, key) => {
    const pages = api(path, true)
    if (!Array.isArray(pages) || !pages.length || pages.some(page => !Array.isArray(page[key])))
      throw new Error('Incomplete CI response.')
    return pages.flatMap(page => page[key])
  }
  try {
    const runs = list(base + 'workflows/' + encodeURIComponent(workflow.split('/').at(-1)) + '/runs?head_sha=' + sha + '&per_page=100', 'workflow_runs')
    let run = runs.filter(sameSource).sort((a, b) => b.id - a.id)[0]
    if (!run) return fallback('No matching CI run was found.')
    const id = run.id
    while (true) {
      run = api(base + 'runs/' + id)
      if (!sameSource(run) || run.id !== id) return fallback('CI source identity changed.')
      if (run.status === 'completed') {
        if (run.conclusion !== 'success') return fallback('The selected CI run did not succeed.')
        const jobs = list(base + 'runs/' + run.id + '/attempts/' + run.run_attempt + '/jobs?per_page=100', 'jobs')
        const complete = jobs.length > 0 && jobs.every(job => job.head_sha === sha && job.run_id === id && job.run_attempt === run.run_attempt
          && job.status === 'completed' && ['success', 'skipped'].includes(job.conclusion))
        const full = jobs.some(job => job.conclusion === 'success' && job.steps?.some(step =>
          step.name === marker && step.status === 'completed' && step.conclusion === 'success'))
        if (!complete || !full) return fallback('CI has no successful complete code-check evidence.')
        const confirmed = api(base + 'runs/' + run.id)
        if (!sameSource(confirmed) || confirmed.id !== id || confirmed.run_attempt !== run.run_attempt
          || confirmed.status !== 'completed' || confirmed.conclusion !== 'success')
          return fallback('CI was rerun or changed while its evidence was read.')
        console.log('Reusing complete CI run ' + run.id + ', attempt ' + run.run_attempt + ' for ' + sha + '.')
        return { 'source-sha': sha, 'run-id': String(run.id) }
      }
      if (!['queued', 'in_progress', 'waiting', 'requested', 'pending'].includes(run.status) || now() >= deadline)
        return fallback('CI has not completed within the wait limit.', true)
      await sleep(Math.min(15000, deadline - now()))
    }
  } catch {
    // API errors are never evidence of success. Fresh checks remain available.
    return fallback('CI lookup was unavailable or returned incomplete data.', true)
  }
}
