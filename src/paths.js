import { homedir } from 'node:os'
import { join } from 'node:path'

export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

export function integrationDir() {
  return join(dshHome(), 'integrations', 'hy-memory')
}

export function dataDir() {
  return join(integrationDir(), 'data')
}

export function venvDir() {
  return join(integrationDir(), 'venv')
}

export function settingsPath() {
  return join(integrationDir(), 'settings.json')
}

export function statePath() {
  return join(integrationDir(), 'state.json')
}

export function logPath() {
  return join(integrationDir(), 'sidecar.log')
}
