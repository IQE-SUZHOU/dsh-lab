/**
 * Verify the AMD skills vendored into `.agents/skills` are discovered by the shipped local skill
 * provider and load with a non-empty body. Run after `pnpm run build`, because the provider
 * packages resolve through their built `lib/` output.
 * @module scripts/verify-vendored-skills
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import { vendoredSkillManifestPath, vendoredSkills } from './vendored-skills.ts'

const root = resolve(import.meta.dirname, '..')

/** One discovery or load gap for a vendored skill, reported without its body. */
export interface VendoredSkillViolation {
  name: string
  problem: string
}

/** sha256 of one vendored `SKILL.md`, so a run proves which bytes were loaded. */
export function vendoredSkillDigest(repoRoot: string, name: string): string {
  const path = resolve(repoRoot, '.agents/skills', name, 'SKILL.md')
  if (!existsSync(path)) return 'SKILL.md missing'
  return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16)
}

/**
 * Boot the shipped registry and local provider over one repository and report vendored-skill gaps.
 * @param repoRoot - Repository whose `.agents/skills` root the provider scans.
 * @returns One diagnostic per missing, outranked, or unloadable vendored skill.
 */
export async function collectVendoredSkillViolations(repoRoot: string): Promise<VendoredSkillViolation[]> {
  const ctx = new Context()
  try {
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SkillFileSystem, { watch: false })
    const catalog = await ctx.skills.snapshot({ cwd: repoRoot })
    const byName = new Map(catalog.skills.map(skill => [skill.name, skill]))
    const violations: VendoredSkillViolation[] = []
    for (const skill of vendoredSkills()) {
      const candidate = byName.get(skill.name)
      if (candidate === undefined) {
        violations.push({ name: skill.name, problem: 'not discovered in any skill root' })
        continue
      }
      if (candidate.source !== 'project-agents') {
        violations.push({
          name: skill.name,
          problem: `won from source "${candidate.source}", expected "project-agents"`,
        })
        continue
      }
      const definition = await ctx.skills.get(skill.name, { cwd: repoRoot })
      if (definition === undefined) {
        violations.push({ name: skill.name, problem: 'listed but not loadable' })
        continue
      }
      if (definition.content.trim().length < 200) {
        violations.push({ name: skill.name, problem: `loaded body is ${String(definition.content.trim().length)} chars` })
      }
    }
    return violations
  } finally {
    await ctx.fiber.dispose()
  }
}

async function main(): Promise<void> {
  const manifestPath = resolve(root, vendoredSkillManifestPath)
  const skills = vendoredSkills()
  const missing = skills.filter(skill => !existsSync(resolve(root, '.agents/skills', skill.name, 'SKILL.md')))
  for (const skill of skills) console.log(`vendored_skill ${skill.name} ${vendoredSkillDigest(root, skill.name)}`)
  if (missing.length > 0) {
    console.error(`verify-vendored-skills: ${missing.map(skill => skill.name).join(', ')} has no .agents/skills entry`)
    process.exitCode = 1
    return
  }
  const violations = await collectVendoredSkillViolations(root)
  if (violations.length > 0) {
    for (const violation of violations) console.error(`verify-vendored-skills: ${violation.name}: ${violation.problem}`)
    console.error(`verify-vendored-skills: ${manifestPath} lists ${String(skills.length)} vendored skill(s).`)
    process.exitCode = 1
    return
  }
  console.log(`verify-vendored-skills: ${String(skills.length)} vendored skill(s) discovered and loaded.`)
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  await main()
}
