import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const windowsPython = resolve(root, '.venv', 'Scripts', 'python.exe')
const unixPython = resolve(root, '.venv', 'bin', 'python')
const python = process.env.PYTHON
  ?? (existsSync(windowsPython) ? windowsPython : existsSync(unixPython) ? unixPython : process.platform === 'win32' ? 'python' : 'python3')
const viteCli = resolve(root, 'node_modules', 'vite', 'bin', 'vite.js')

if (!existsSync(viteCli)) {
  console.error('Vite is not installed. Run npm install before starting the app.')
  process.exit(1)
}

console.log('Starting the Expense Tracker API and frontend...')

let stopping = false
const children = []

function stop(code) {
  if (stopping) return
  stopping = true
  process.exitCode = code
  for (const child of children) {
    if (child.exitCode === null) child.kill()
  }
}

function start(command, args) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', env: process.env })
  children.push(child)
  child.on('error', (error) => {
    console.error(`Could not start ${command}: ${error.message}`)
    stop(1)
  })
  child.on('exit', (code) => {
    if (!stopping) stop(code ?? 1)
  })
  return child
}

start(python, ['-m', 'uvicorn', 'backend.main:app', '--reload', '--reload-dir', 'backend'])
start(process.execPath, [viteCli, ...process.argv.slice(2)])

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
