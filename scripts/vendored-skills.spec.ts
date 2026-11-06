import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseVendoredSkillManifest, vendoredSkillManifestPath, vendoredSkills } from './vendored-skills.ts'
import { collectVendoredSkillViolations, vendoredSkillDigest } from './verify-vendored-skills.ts'

const root = resolve(import.meta.dirname, '..')

describe('the vendored skill manifest', () => {
  const manifest = parseVendoredSkillManifest()

  it('names the source repository and pins one commit per skill', () => {
    expect(manifest.vendored_from.repo).toBe('amd/skills')
    expect(manifest.vendored_from.commit).toMatch(/^[0-9a-f]{40}$/)
    for (const skill of manifest.skills) {
      expect(skill.upstream.repo).toMatch(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/)
      expect(skill.upstream.commit).toMatch(/^[0-9a-f]{7,40}$/)
    }
  })

  it('lists each vendored skill once, in the manifest order the file records', () => {
    const names = manifest.skills.map(skill => skill.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names.length).toBeGreaterThan(0)
  })

  it('is the single source the acceptance script reads', () => {
    expect(vendoredSkills().map(skill => skill.name)).toEqual(
      [...manifest.skills].map(skill => skill.name).sort(),
    )
    expect(readFileSync(resolve(root, vendoredSkillManifestPath), 'utf8')).toContain('"vendored_from"')
  })
})

describe('the vendored skills', () => {
  it.for(vendoredSkills())('%s ships a SKILL.md with a parseable frontmatter name', (skill) => {
    const source = readFileSync(resolve(root, '.agents/skills', skill.name, 'SKILL.md'), 'utf8')
    const frontmatter = source.split('\n').slice(1).join('\n')
    expect(frontmatter).toContain(`name: ${skill.name}`)
    expect(vendoredSkillDigest(root, skill.name)).toMatch(/^[0-9a-f]{16}$/)
  })

  it('are discovered by the local provider and loadable through the registry', async () => {
    expect(await collectVendoredSkillViolations(root)).toEqual([])
  })
})
