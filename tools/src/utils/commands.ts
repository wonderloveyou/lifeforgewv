import { type IOType, spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'

import { ROOT_DIR } from '@/constants/constants'
import { getPackageTarballUrl } from '@/utils/registry'

import Logging, { LEVEL_ORDER } from './logging'
import { addDependency } from './packageJson'

interface CommandExecutionOptions {
  stdio?: IOType | [IOType, IOType, IOType]
  cwd?: string
  env?: Record<string, string>
  exitOnError?: boolean
}

/**
 * Executes a shell command synchronously with proper error handling.
 *
 * @param command - The command to execute, either as a string or a function that returns a string
 * @param options - Execution options including stdio, cwd, env, and exitOnError
 * @param _arguments - Additional arguments to append to the command
 * @returns The trimmed stdout output from the command
 * @throws Re-throws errors if `exitOnError` is false, otherwise exits the process
 */
export default function executeCommand(
  command: string | (() => string),
  options: CommandExecutionOptions = {},
  _arguments: string[] = []
): string {
  let cmd: string

  try {
    cmd = typeof command === 'function' ? command() : command
  } catch (error) {
    Logging.actionableError(
      `Failed to generate command: ${error}`,
      'Check the command generation logic for errors'
    )
    process.exit(1)
  }

  try {
    Logging.debug(`Executing: ${cmd}`)

    const [toBeExecuted, ...args] = cmd.split(' ')

    const result = spawnSync(toBeExecuted, [...args, ..._arguments], {
      stdio: 'inherit',
      encoding: 'utf8',
      shell: true,
      ...options
    })

    if (result.error) {
      throw result.error
    }

    if (result.status !== 0) {
      throw result.status
    }

    if (!options.stdio || options.stdio === 'inherit') {
      Logging.debug(`Completed: ${cmd}`)
    }

    return result.stdout?.toString().trim() || ''
  } catch (error) {
    if (!options.exitOnError) {
      throw error
    }

    Logging.actionableError(
      `Command execution failed: ${cmd}`,
      'Check if the command exists and you have the necessary permissions'
    )
    Logging.debug(`Error details: ${error}`)
    process.exit(1)
  }
}

/**
 * Runs `bun install` in the root directory to install dependencies.
 */
export function bunInstall() {
  const backend = process.platform === 'win32' ? ' --backend=copy' : ''
  try {
    executeCommand(`bun install${backend}`, {
      cwd: ROOT_DIR,
      stdio: Logging.level > LEVEL_ORDER['debug'] ? 'pipe' : 'inherit'
    })
  } catch (error) {
    if (error === 1) {
      Logging.debug(
        'Bun reported an error during install, but continuing as it usually works anyway...'
      )
      return
    }
    throw error
  }
}

/**
 * Installs a package from the registry and copies it to the target directory.
 *
 * Downloads the package tarball from the registry, extracts it to the target
 * directory, adds it as a workspace dependency, and runs `bun install`.
 *
 * @param fullName - The full package name (e.g., `@lifeforge/lifeforge--calendar`)
 * @param targetDir - The absolute path to copy the package to
 */
export async function installPackage(fullName: string, targetDir: string) {
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true })
  }

  Logging.debug(`Installing ${Logging.highlight(fullName)} from registry...`)

  const tarballUrl = await getPackageTarballUrl(fullName)

  if (!tarballUrl) {
    Logging.actionableError(
      `Failed to find tarball for ${Logging.highlight(fullName)}`,
      'Check if the package exists in the registry'
    )
    process.exit(1)
  }

  const tempDir = path.join(ROOT_DIR, '.forge-temp')
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true })
  }

  const tarballPath = path.join(tempDir, `${fullName.replace('/', '-')}.tgz`)
  const extractPath = path.join(tempDir, fullName.replace('/', '-'))

  if (fs.existsSync(extractPath)) {
    fs.rmSync(extractPath, { recursive: true, force: true })
  }
  fs.mkdirSync(extractPath, { recursive: true })

  Logging.debug(`Downloading tarball from ${tarballUrl}...`)

  executeCommand(`curl.exe -L -o "${tarballPath}" "${tarballUrl}"`, {
    cwd: ROOT_DIR,
    stdio: 'pipe'
  })

  Logging.debug(`Extracting tarball...`)

  executeCommand(`tar -xf "${tarballPath}" -C "${extractPath}"`, {
    cwd: ROOT_DIR,
    stdio: 'pipe'
  })

  const packagePath = path.join(extractPath, 'package')

  if (!fs.existsSync(packagePath)) {
    Logging.actionableError(
      `Failed to extract ${Logging.highlight(fullName)}`,
      'The tarball might be corrupted or in an unexpected format'
    )
    process.exit(1)
  }

  Logging.debug(`Moving ${Logging.highlight(fullName)} to ${targetDir}...`)

  fs.mkdirSync(path.dirname(targetDir), { recursive: true })
  fs.renameSync(packagePath, targetDir)

  // Clean up
  fs.rmSync(extractPath, { recursive: true, force: true })
  if (fs.existsSync(tarballPath)) {
    fs.rmSync(tarballPath, { force: true })
  }

  addDependency(fullName)
  bunInstall()
}
