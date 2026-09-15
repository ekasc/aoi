import { Redirect } from "expo-router";

import ChapterDetailScreen from "@/app/(app)/chapter/[id]";
import { DevErrorBoundary, useApplyPreviewVariant } from "@/features/dev/preview";

/**
 * Development-only chapter preview (?id=month:YYYY-MM). Same convention
 * as dev-foundations/dev-story: not linked from any navigation; renders
 * the REAL chapter screen through the REAL provider tree with stub range
 * data. Open a month from /dev/story and copy its id here, e.g.
 * /dev/chapter?id=month:2026-08.
 *
 * Genuinely development-only: production builds (`__DEV__ === false`)
 * redirect to the app root instead of rendering preview content.
 */
export default function DevChapter() {
	if (!__DEV__) {
		return <Redirect href="/" />;
	}
	return <DevChapterPreview />;
}

function DevChapterPreview() {
	// Chapters read stub range data, so they need the same seeds as the
	// feed. Pick a month with no seeds (e.g. ?id=month:2020-01) to see the
	// empty chapter.
	useApplyPreviewVariant("full");
	return (
		<DevErrorBoundary label="ChapterDetailScreen">
			<ChapterDetailScreen />
		</DevErrorBoundary>
	);
}
