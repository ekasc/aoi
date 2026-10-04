import { Redirect, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";

import { UsPhotoSky } from "@/app/(app)/(tabs)/together";
import { usePreviewSkyPhotos } from "@/features/dev/sky-photo-preview";
import { CalendarProvider } from "@/features/calendar/calendar-context";
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
import { LettersProvider } from "@/features/letters/letters-context";
import { PartnerDetailsProvider } from "@/features/partner-details/partner-details-context";
import { ProposalsProvider } from "@/features/proposals/proposals-context";
import { PushProvider } from "@/features/push/push-context";
import { QuestionProvider } from "@/features/question/question-context";
import { ResponsesProvider } from "@/features/responses/responses-context";
import { SessionContext } from "@/features/session/session-context";
import { SomedayProvider } from "@/features/someday/someday-context";
import { SpaceContext } from "@/features/space/space-context";
import { SqueezeProvider } from "@/features/squeeze/squeeze-context";

/**
 * Development-only Us screen preview: the whole mock world behind the same
 * providers the real app tree uses, so the screen renders as it ships. The
 * Us tab is the one screen without a preview route and it is the one being
 * worked on, so this is where it gets inspected on web.
 *
 * Not linked from any navigation. Production builds redirect home.
 */
export default function DevTogether() {
	if (!__DEV__) {
		return <Redirect href="/" />;
	}
	return <DevTogetherPreview />;
}

function PreviewSky({ variant }: { variant: PreviewVariant }) {
	const album = usePreviewSkyPhotos(variant);
	return <UsPhotoSky album={album} />;
}

function DevTogetherPreview() {
	const { variant } = useLocalSearchParams<{ variant?: string | string[] }>();
	const selected = parsePreviewVariant(
		Array.isArray(variant) ? variant[0] : variant,
	);
	useApplyPreviewVariant(selected);
	const [readyVariant, setReadyVariant] = useState<PreviewVariant | null>(null);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				await resetPreviewComposerStore(selected);
			} catch {
				// Seeds are best-effort; the screen renders regardless.
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
				<CalendarProvider>
					<PartnerDetailsProvider>
						<SomedayProvider>
							<QuestionProvider>
								<SqueezeProvider>
									<ProposalsProvider>
										<LettersProvider>
											<PushProvider>
												<ResponsesProvider>
													<ComposerProvider>
														<DevErrorBoundary label="TogetherScreen">
															<PreviewSky key={selected} variant={selected} />
														</DevErrorBoundary>
													</ComposerProvider>
												</ResponsesProvider>
											</PushProvider>
										</LettersProvider>
									</ProposalsProvider>
								</SqueezeProvider>
							</QuestionProvider>
						</SomedayProvider>
					</PartnerDetailsProvider>
				</CalendarProvider>
			</SpaceContext.Provider>
		</SessionContext.Provider>
	);
}
