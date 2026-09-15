import { Redirect, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";

import MemoriesScreen from "@/app/(app)/(tabs)/(memories)/index";
import { ComposerProvider } from "@/features/composer/composer-context";
import {
	DevErrorBoundary,
	PREVIEW_SESSION,
	PREVIEW_SPACE,
	parsePreviewVariant,
	resetPreviewComposerStore,
	useApplyPreviewVariant,
	type PreviewVariant,
} from "@/features/dev/preview";
import { SessionContext } from "@/features/session/session-context";
import { SpaceContext } from "@/features/space/space-context";

/**
 * Development-only Story feed preview: the complete mock world (Maya,
 * signed in, space ready, rich seeds). Same convention as
 * dev-foundations: not linked from any navigation; for design inspection
 * on web/device (authenticated screens are unreachable on web, simulators
 * are slow). Renders the REAL screen through the REAL provider tree —
 * the stub data layer swaps its seeds, nothing else changes.
 *
 * This route renders the feed screen directly, so it has no bottom tab bar
 * (the tab navigator lives in the (tabs) layout, which only mounts under
 * the real app tree). That is expected for a single-screen preview; use the
 * real app to exercise tab navigation.
 *
 * Variants: /dev-story (full) · ?variant=empty (blank slate) ·
 * ?variant=pending (unsent memory pinned) · ?variant=failed (failed send
 * with Retry/Edit/Remove). Saving a text memory runs the real composer
 * pipeline against stub storage, so keeps and retries land in the feed.
 *
 * Genuinely development-only: production builds (`__DEV__ === false`)
 * redirect to the app root instead of rendering preview content.
 */
export default function DevStory() {
	if (!__DEV__) {
		return <Redirect href="/" />;
	}
	return <DevStoryPreview />;
}

function DevStoryPreview() {
	const { variant } = useLocalSearchParams<{ variant?: string | string[] }>();
	const selected = parsePreviewVariant(
		Array.isArray(variant) ? variant[0] : variant,
	);
	useApplyPreviewVariant(selected);
	// Seed the composer store BEFORE providers mount so hydration picks
	// the variant's pending rows up deterministically (no race). Drafts
	// survive variant switches; pending rows are variant-owned.
	const [readyVariant, setReadyVariant] = useState<PreviewVariant | null>(
		null,
	);
	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				await resetPreviewComposerStore(selected);
			} catch {
				// Seeds are best-effort; the feed renders regardless.
			}
			if (!cancelled) {
				setReadyVariant(selected);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [selected]);
	if (readyVariant !== selected) {
		return null;
	}
	return (
		<SessionContext.Provider value={PREVIEW_SESSION}>
			<SpaceContext.Provider value={PREVIEW_SPACE}>
				<ComposerProvider>
					<DevErrorBoundary label="MemoriesScreen">
						<MemoriesScreen />
					</DevErrorBoundary>
				</ComposerProvider>
			</SpaceContext.Provider>
		</SessionContext.Provider>
	);
}
