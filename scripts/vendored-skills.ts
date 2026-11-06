/**
 * Read the checked-in record of skills vendored into `.agents/skills` from another repository.
 * The manifest is the single source for the vendor list: the acceptance script, the cookbook, and
 * a refresh all read the same names instead of restating them. See
 * [adding-vendored-skills.md](../docs/cookbook/adding-vendored-skills.md).
 * @module scripts/vendored-skills
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

/** Repository-relative path of the vendored-skill manifest. */
export const vendoredSkillManifestPath = 'scripts/vendored-skills.manifest.json'

/** One vendored skill and the upstream commit its directory was copied from. */
export interface VendoredSkill {
  /** Kebab-case skill name; also the directory name under `.agents/skills`. */
  name: string
  /** Upstream coordinates of the copied directory. */
  upstream: { repo: string; ref: string; commit: string; license: string | null }
}

/** The repository-level vendor record that wraps the skill list. */
export interface VendoredSkillManifest {
  /** Repository the whole batch was copied from. */
  vendored_from: { repo: string; ref: string; commit: string; source_commit_date: string; imported_at: string }
  /** Vendored skills, sorted by name. */
  skills: VendoredSkill[]
}

/**
 * Parse the vendored-skill manifest or fail before a caller acts on a partial list.
 * @returns The validated manifest.
 * @throws Error when the manifest is absent, malformed, or lists a skill twice.
 */
export function parseVendoredSkillManifest(): VendoredSkillManifest {
  const path = resolve(root, vendoredSkillManifestPath)
  if (!existsSync(path)) throw new Error(`${vendoredSkillManifestPath} is missing`)
  const document = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  const source = recordField(document.vendored_from, 'vendored_from')
  if (typeof source.repo !== 'string' || typeof source.commit !== 'string') {
    throw new Error(`${vendoredSkillManifestPath}: vendored_from must name the source repository and commit`)
  }
  if (!Array.isArray(document.skills) || document.skills.length === 0) {
    throw new Error(`${vendoredSkillManifestPath}: skills must be a non-empty array`)
  }
  const skills = document.skills.map((entry): VendoredSkill => {
    const skill = recordField(entry, 'skills entry')
    if (typeof skill.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name)) {
      throw new Error(`${vendoredSkillManifestPath}: every skill needs a kebab-case name`)
    }
    const upstream = recordField(skill.upstream, `${skill.name} upstream`)
    if (typeof upstream.repo !== 'string' || typeof upstream.commit !== 'string') {
      throw new Error(`${vendoredSkillManifestPath}: ${skill.name} needs upstream repo and commit`)
    }
    return {
      name: skill.name,
      upstream: {
        repo: upstream.repo,
        ref: typeof upstream.ref === 'string' ? upstream.ref : 'main',
        commit: upstream.commit,
        license: typeof upstream.license === 'string' ? upstream.license : null,
      },
    }
  })
  const names = skills.map(skill => skill.name)
  const duplicate = names.find((name, index) => names.indexOf(name) !== index)
  if (duplicate !== undefined) throw new Error(`${vendoredSkillManifestPath}: ${duplicate} is listed twice`)
  return {
    vendored_from: {
      repo: source.repo,
      ref: typeof source.ref === 'string' ? source.ref : 'main',
      commit: source.commit,
      source_commit_date: typeof source.source_commit_date === 'string' ? source.source_commit_date : '',
      imported_at: typeof source.imported_at === 'string' ? source.imported_at : '',
    },
    skills,
  }
}

/** Read one JSON value as an object, naming the field a caller asked for. */
function recordField(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${vendoredSkillManifestPath}: ${label} must be an object`)
  }
  return value as Record<string, unknown>
}

/** The vendored skill entries, sorted by name. */
export function vendoredSkills(): VendoredSkill[] {
  return [...parseVendoredSkillManifest().skills].sort((left, right) => left.name.localeCompare(right.name))
}
