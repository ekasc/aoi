import { Stack, useRouter } from "expo-router";
import { useCallback } from "react";

import {
	MomentForm,
	type MomentFormValues,
} from "@/components/moments/moment-form";
import { useMoments } from "@/features/moments/moments-context";
import { useSession } from "@/features/session/session-context";

export default function NewMomentScreen() {
	const router = useRouter();
	const { addMoment } = useMoments();
	const { user } = useSession();

	const handleCancel = useCallback(() => {
		router.back();
	}, [router]);

	const handleSubmit = useCallback(
		async (values: MomentFormValues) => {
			await addMoment({
				type: values.type,
				title: values.title,
				body: values.body,
				occurredAt: values.occurredAt,
				targetAt: values.targetAt,
				authorId: user?.id ?? "user_you",
				authorRole: "you",
				authorName: user?.displayName ?? "You",
				mediaPreview: values.mediaPreview ?? undefined,
				audioUri: values.audioUri,
			});
			router.back();
		},
		[addMoment, router, user],
	);

	return (
		<>
			<Stack.Screen options={{ title: "Add moment" }} />
			<MomentForm
				heroTitle="Capture a moment"
				heroSubtitle="What kind of moment was it?"
				onCancel={handleCancel}
				onSubmit={handleSubmit}
				submitLabel="Save moment"
				submittingLabel="Saving…"
			/>
		</>
	);
}
