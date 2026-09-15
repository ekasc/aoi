import { Stack, useRouter } from "expo-router";
import { useCallback } from "react";

import {
	MomentForm,
	type MomentFormValues,
} from "@/components/moments/moment-form";
import { useMoments } from "@/features/moments/moments-context";
import { useSession } from "@/features/session/session-context";

/**
 * Plans-owned future-goal capture. Goals live in the same goal-moment
 * store as historical records (no second system); Story never offers this
 * — new goals start here.
 */
export default function NewGoalScreen() {
	const router = useRouter();
	const { addMoment } = useMoments();
	const { user } = useSession();

	const handleCancel = useCallback(() => {
		router.back();
	}, [router]);

	const handleSubmit = useCallback(
		async (values: MomentFormValues) => {
			await addMoment({
				type: "goal",
				title: values.title,
				body: values.body,
				occurredAt: values.occurredAt,
				targetAt: values.targetAt,
				authorId: user?.id ?? "user_you",
				authorRole: "you",
				authorName: user?.displayName ?? "You",
				mediaPreview: values.mediaPreview ?? undefined,
				audioUri: values.audioUri,
				mediaId: values.mediaId,
				clientId: values.clientId,
			});
			router.back();
		},
		[addMoment, router, user],
	);

	return (
		<>
			<Stack.Screen options={{ title: "New goal" }} />
			<MomentForm
				defaultType="goal"
				heroSubtitle="Something to look forward to, together."
				heroTitle="Set a future goal"
				hideTypePicker
				onCancel={handleCancel}
				onSubmit={handleSubmit}
				submitLabel="Save goal"
				submittingLabel="Saving…"
			/>
		</>
	);
}
