/**
 * Registry of all check implementations.
 */

import type { CheckFn } from '../types.js';
import { lifecycleChecks } from './lifecycle.js';
import { toolsChecks } from './tools.js';
import { resourcesChecks } from './resources.js';
import { promptsChecks } from './prompts.js';
import { errorsChecks } from './errors.js';

/**
 * Returns a map of test ID → check function for all implemented checks.
 */
export function getChecks(): Map<string, CheckFn> {
  const map = new Map<string, CheckFn>();

  const allChecks = [
    ...lifecycleChecks,
    ...toolsChecks,
    ...resourcesChecks,
    ...promptsChecks,
    ...errorsChecks,
  ];

  for (const [id, fn] of allChecks) {
    map.set(id, fn);
  }

  return map;
}
