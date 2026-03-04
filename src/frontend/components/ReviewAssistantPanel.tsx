/*
 * Copyright 2026 John Ewart <john@johnewart.net>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
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

import { UnifiedChatPanel } from './UnifiedChatPanel';

interface ReviewAssistantPanelProps {
  sessionId: string | null;
  /** When set (e.g. on PR page), the PR is included in agent context. */
  prContext?: { pullNumber: number };
}

export function ReviewAssistantPanel({ sessionId, prContext }: ReviewAssistantPanelProps) {
  return (
    <UnifiedChatPanel
      sessionId={sessionId}
      prContext={prContext}
      defaultModeId="code_reviewer"
      storageKeysPrefix="review"
      variant="embedded"
      title="Chat about this review"
      emptyPlaceholder="Ask the agent about the diff, suggestions, or any review question."
      showCancelButton={false}
    />
  );
}
