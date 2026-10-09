import { Redirect, useLocalSearchParams } from "expo-router";

import { ComposerProvider } from "@/features/composer/composer-context";
import { InlineMemoryComposer } from "@/components/moments/inline-memory-composer";
import {
	DevErrorBoundary,
	PREVIEW_SESSION,
	PREVIEW_SPACE,
} from "@/features/dev/preview";
import { SessionContext } from "@/features/session/session-context";
import { SpaceContext } from "@/features/space/space-context";

/**
 * Development-only composer preview: the REAL InlineMemoryComposer with a
 * working scope, for inspecting editor layout/keyboard structure on web
 * (the /(app)/moment/new route is auth-guarded). Same __DEV__ convention
 * as the other dev routes. Not linked from any navigation.
 */
export default function DevComposer() {
	const { dedication } = useLocalSearchParams<{ dedication?: string }>();
	if (!__DEV__) {
		return <Redirect href="/" />;
	}
	return (
		<SessionContext.Provider value={PREVIEW_SESSION}>
			<SpaceContext.Provider value={PREVIEW_SPACE.space && dedication === 'partner' ? { ...PREVIEW_SPACE, space: { ...PREVIEW_SPACE.space, partnerJoined: false } } : PREVIEW_SPACE}>
				<ComposerProvider>
					<DevErrorBoundary label="InlineMemoryComposer">
						<InlineMemoryComposer dedication={dedication === 'partner'} />
					</DevErrorBoundary>
				</ComposerProvider>
			</SpaceContext.Provider>
		</SessionContext.Provider>
	);
}
