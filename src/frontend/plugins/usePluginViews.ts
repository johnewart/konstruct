/*
 * Copyright 2026 John Ewart <john@johnewart.net>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use it except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useState, useEffect, useMemo } from 'react';
import { trpc } from '../../client/trpc';
import type { PluginViewMeta } from './registry';

export interface PluginViewEntry extends PluginViewMeta {
  id: string;
}

/** Load view by convention: konstruct-plugin-<id>/view (path, label, default component). */
function loadPluginView(id: string): Promise<PluginViewEntry | null> {
  return import(/* @vite-ignore */ `konstruct-plugin-${id}/view`)
    .then((mod) => {
      if (!mod?.default || typeof mod.path !== 'string' || typeof mod.label !== 'string')
        return null;
      return {
        id,
        path: mod.path,
        label: mod.label,
        Component: mod.default,
      };
    })
    .catch(() => null);
}

export function usePluginViews(): {
  views: PluginViewEntry[];
  isLoading: boolean;
} {
  const { data, isLoading: queryLoading } = trpc.plugins.listEnabled.useQuery();
  const [loaded, setLoaded] = useState<PluginViewEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const enabledIds = useMemo(
    () => (data?.plugins?.map((p) => p.id) ?? []),
    [data?.plugins]
  );

  useEffect(() => {
    if (!data?.plugins?.length) {
      setLoaded([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all(enabledIds.map(loadPluginView)).then((entries) => {
      if (!cancelled) {
        setLoaded(entries.filter((e): e is PluginViewEntry => e != null));
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [enabledIds.join(','), data?.plugins?.length]);

  return {
    views: loaded,
    isLoading: queryLoading || loading,
  };
}
