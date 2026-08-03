import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	type PropsWithChildren,
} from "react";

import { useSession } from "@/features/session/session-context";
import { getSpaceRepository } from "@/features/space/space-repository";
import type {
	CreateSpaceInput,
	ImportedMilestone,
	ImportedMilestoneInput,
	JoinSpaceInput,
	RelationshipSpace,
	SpaceContextValue,
	SpaceStatus,
	UpdateSpaceInput,
} from "@/features/space/types";

const SpaceContext = createContext<SpaceContextValue | undefined>(undefined);

function buildImportedMilestones(
	inputs: ImportedMilestoneInput[],
): ImportedMilestone[] {
	const now = new Date().toISOString();

	return inputs.map((input, index) => ({
		id: `import_${Date.now()}_${index}_${Math.floor(Math.random() * 100000)}`,
		title: input.title.trim(),
		body: input.body?.trim() || undefined,
		type: input.type,
		occurredAt: input.occurredAt,
		targetAt: input.targetAt ?? null,
		createdAt: now,
	}));
}

export function SpaceProvider({ children }: PropsWithChildren) {
	const { status: sessionStatus, user } = useSession();
	const repository = useMemo(() => getSpaceRepository(), []);
	const [status, setStatus] = useState<SpaceStatus>("loading");
	const [space, setSpace] = useState<RelationshipSpace | null>(null);
	const [importedMilestones, setImportedMilestones] = useState<
		ImportedMilestone[]
	>([]);
	const [isHydrated, setIsHydrated] = useState(false);

	useEffect(() => {
		let isActive = true;

		if (sessionStatus === "loading") {
			setStatus("loading");
			setSpace(null);
			setImportedMilestones([]);
			setIsHydrated(false);
			return;
		}

		if (sessionStatus === "signed_out" || !user) {
			setStatus("none");
			setSpace(null);
			setImportedMilestones([]);
			setIsHydrated(true);
			return;
		}

		const userId = user.id;

		setStatus("loading");
		setIsHydrated(false);

		async function hydrateSpace() {
			try {
				const [nextSpace, nextImportedMilestones] = await Promise.all([
					repository.getSpaceForUser(userId),
					repository.getImportedMilestonesForUser(userId),
				]);

				if (!isActive) {
					return;
				}

				setSpace(nextSpace);
				setImportedMilestones(nextImportedMilestones);
				setStatus(nextSpace ? "ready" : "none");
			} catch {
				if (!isActive) {
					return;
				}

				setSpace(null);
				setImportedMilestones([]);
				setStatus("error");
			} finally {
				if (isActive) {
					setIsHydrated(true);
				}
			}
		}

		void hydrateSpace();

		return () => {
			isActive = false;
		};
	}, [repository, sessionStatus, user]);

	const createSpace = useCallback(
		async (input: CreateSpaceInput) => {
			const nextSpace = await repository.createSpace(input);
			setSpace(nextSpace);
			setStatus("ready");
			return nextSpace;
		},
		[repository],
	);

	const joinSpace = useCallback(
		async (input: JoinSpaceInput) => {
			const joinedSpace = await repository.joinSpace(input);
			setSpace(joinedSpace);
			setStatus("ready");
			return joinedSpace;
		},
		[repository],
	);

	const updateSpace = useCallback(
		async (input: UpdateSpaceInput) => {
			if (!user) {
				return null;
			}

			const nextSpace = await repository.updateSpaceForUser(
				user.id,
				input,
			);
			setSpace(nextSpace);
			setStatus(nextSpace ? "ready" : "none");
			return nextSpace;
		},
		[repository, user],
	);

	const clearSpace = useCallback(async () => {
		if (!user) {
			return;
		}

		await repository.clearSpaceForUser(user.id);
		setSpace(null);
		setImportedMilestones([]);
		setStatus("none");
	}, [repository, user]);

	const leaveSpace = useCallback(async () => {
		if (!user) {
			return;
		}

		await repository.leaveSpace(user.id);
		setSpace(null);
		setImportedMilestones([]);
		setStatus("none");
	}, [repository, user]);

	const importMilestones = useCallback(
		async (inputs: ImportedMilestoneInput[]) => {
			if (!user || inputs.length === 0) {
				return [];
			}

			const nextMilestones = buildImportedMilestones(inputs);
			const persistedMilestones =
				await repository.appendImportedMilestonesForUser(
					user.id,
					nextMilestones,
				);
			setImportedMilestones(persistedMilestones);
			return nextMilestones;
		},
		[repository, user],
	);

	const value = useMemo<SpaceContextValue>(
		() => ({
			status,
			space,
			importedMilestones,
			isHydrated,
			createSpace,
			joinSpace,
			updateSpace,
			clearSpace,
			leaveSpace,
			importMilestones,
		}),
		[
			status,
			space,
			importedMilestones,
			isHydrated,
			createSpace,
			joinSpace,
			updateSpace,
			clearSpace,
			leaveSpace,
			importMilestones,
		],
	);

	return (
		<SpaceContext.Provider value={value}>{children}</SpaceContext.Provider>
	);
}

export function useSpace() {
	const context = useContext(SpaceContext);

	if (!context) {
		throw new Error("useSpace must be used within SpaceProvider");
	}

	return context;
}
