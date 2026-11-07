import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type PropsWithChildren,
} from "react";
import { AppState } from "react-native";

import { useSession } from "@/features/session/session-context";
import { getSpaceRepository } from "@/features/space/space-repository";
import {
	clearSpaceSnapshot,
	readSpaceSnapshot,
	writeSpaceSnapshot,
} from "@/features/space/space-snapshot";
import type {
	CreateSpaceInput,
	JoinSpaceInput,
	RelationshipSpace,
	SpaceContextValue,
	SpaceStatus,
	UpdateSpaceInput,
} from "@/features/space/types";

/**
 * Exported for dev-preview routes, which provide seed values directly
 * (headless environments never complete onboarding). Never used by app UI.
 */
export const SpaceContext = createContext<SpaceContextValue | undefined>(undefined);

export function SpaceProvider({ children }: PropsWithChildren) {
	const { status: sessionStatus, user } = useSession();
	const repository = useMemo(() => getSpaceRepository(), []);
	const [status, setStatus] = useState<SpaceStatus>("loading");
	const [space, setSpace] = useState<RelationshipSpace | null>(null);
	const [isHydrated, setIsHydrated] = useState(false);
	const currentSpace = useRef(space);
	const revision = useRef(0);
	const accountGeneration = useRef(0);
	const userId = user?.id;
	useLayoutEffect(() => { currentSpace.current = space; }, [space]);
	const activeUser = useRef(sessionStatus === 'signed_in' ? user?.id : undefined);
	useLayoutEffect(() => {
		accountGeneration.current += 1;
		activeUser.current = sessionStatus === 'signed_in' ? user?.id : undefined;
		return () => { activeUser.current = undefined; };
	}, [sessionStatus, user?.id]);

	useEffect(() => {
		let isActive = true;

		if (sessionStatus === "loading") {
			// eslint-disable-next-line react-hooks/set-state-in-effect -- Clear session-dependent data before a different account hydrates.
			setStatus("loading");
			setSpace(null);
			setIsHydrated(false);
			return;
		}

		if (sessionStatus === "signed_out" || !userId) {
			setStatus("none");
			setSpace(null);
			setIsHydrated(true);
			return;
		}

		setStatus("loading");
		setSpace(null);
		setIsHydrated(false);
		const startedAt = ++revision.current;

		async function hydrateSpace(userId: string) {
			// First paint comes from the device, not the network.
			//
			// The space read is one round trip (230–450ms measured) and it
			// fails often enough that waiting on it used to mean a spinner, or
			// worse, an onboarding screen. The last known space is written down
			// on every read and change, so a returning reader gets the app
			// drawn straight away and the request only reconciles underneath.
			const snapshot = await readSpaceSnapshot(userId);

			if (!isActive || startedAt !== revision.current) {
				return;
			}

			if (snapshot) {
				setSpace(snapshot);
				setStatus("ready");
				setIsHydrated(true);
			}

			try {
				const nextSpace = await repository.getSpaceForUser(userId);

				if (!isActive || startedAt !== revision.current) {
					return;
				}

				const resolved = nextSpace ?? snapshot;
				setSpace(resolved);
				setStatus(resolved ? "ready" : "none");

				if (nextSpace) {
					void writeSpaceSnapshot(userId, nextSpace);
				}
			} catch {
				if (!isActive || startedAt !== revision.current) {
					return;
				}

				// A failed refresh with a snapshot in hand is invisible: the
				// reader keeps the space they had instead of being sent back to
				// onboarding by a transient 5xx.
				if (!snapshot) {
					setSpace(null);
					setStatus("error");
				}
			} finally {
				if (isActive) {
					setIsHydrated(true);
				}
			}
		}

		void hydrateSpace(userId);

		return () => {
			isActive = false;
		};
	}, [repository, sessionStatus, userId]);

	// Mutation callbacks started under one account must not write state after
	// the session has changed. The hydration effect and refreshSpace already
	// guard this; create/join/update/leave/regenerate need the same check
	// because their requests can also outlive a sign-out or account switch.
	const isStillActiveUser = useCallback(
		(userId: string | undefined) =>
			Boolean(userId) && activeUser.current === userId,
		[],
	);

	const createSpace = useCallback(
		async (input: CreateSpaceInput) => {
			const startedAt = revision.current;
			const nextSpace = await repository.createSpace(input);
			if (!isStillActiveUser(userId) || startedAt !== revision.current) return nextSpace;
			revision.current += 1;
			setSpace(nextSpace);
			setStatus("ready");
			if (userId) void writeSpaceSnapshot(userId, nextSpace);
			return nextSpace;
		},
		[isStillActiveUser, repository, userId],
	);

	const joinSpace = useCallback(
		async (input: JoinSpaceInput) => {
			const startedAt = revision.current;
			const joinedSpace = await repository.joinSpace(input);
			if (!isStillActiveUser(userId) || startedAt !== revision.current) return joinedSpace;
			revision.current += 1;
			setSpace(joinedSpace);
			setStatus("ready");
			if (userId) void writeSpaceSnapshot(userId, joinedSpace);
			return joinedSpace;
		},
		[isStillActiveUser, repository, userId],
	);

	const updateSpace = useCallback(
		async (input: UpdateSpaceInput) => {
			if (!user) {
				return null;
			}

			const startedAt = revision.current;
			const nextSpace = await repository.updateSpaceForUser(
				user.id,
				input,
			);
			if (!isStillActiveUser(user.id) || startedAt !== revision.current) return nextSpace;
			if (!nextSpace) return currentSpace.current;
			revision.current += 1;
			setSpace(nextSpace);
			setStatus("ready");
			void writeSpaceSnapshot(user.id, nextSpace);
			return nextSpace;
		},
		[isStillActiveUser, repository, user],
	);

	const clearSpace = useCallback(async () => {
		if (!user) {
			return;
		}

		const generation = accountGeneration.current;
		const spaceId = currentSpace.current?.id;
		await repository.clearSpaceForUser(user.id);
		if (!isStillActiveUser(user.id) || generation !== accountGeneration.current || spaceId !== currentSpace.current?.id) return;
		revision.current += 1;
		void clearSpaceSnapshot(user.id);
		setSpace(null);
		setStatus("none");
	}, [isStillActiveUser, repository, user]);

	const leaveSpace = useCallback(async () => {
		if (!user) {
			return;
		}

		const generation = accountGeneration.current;
		const spaceId = currentSpace.current?.id;
		await repository.leaveSpace(user.id);
		if (!isStillActiveUser(user.id) || generation !== accountGeneration.current || spaceId !== currentSpace.current?.id) return;
		revision.current += 1;
		void clearSpaceSnapshot(user.id);
		setSpace(null);
		setStatus("none");
	}, [isStillActiveUser, repository, user]);

	const regenerateInvite = useCallback(async () => {
		if (!user) {
			throw new Error("Not signed in.");
		}

		const startedAt = revision.current;
		const inviteCode = await repository.regenerateInvite(user.id);
		// Re-read so expiry/joined state comes from the authority, not a guess.
		const refreshed = await repository.getSpaceForUser(user.id).catch(() => null);
		if (!isStillActiveUser(user.id) || startedAt !== revision.current) return inviteCode;
		revision.current += 1;
		if (refreshed) {
			setSpace(refreshed);
		} else {
			setSpace((current) => (current ? { ...current, inviteCode } : current));
		}
		return inviteCode;
	}, [isStillActiveUser, repository, user]);

	const refreshSpace = useCallback(async () => {
		if (!user) {
			return;
		}

		// Failed reads leave the current space intact and reach the calling UI.
		const startedAt = revision.current;
		const nextSpace = await repository.getSpaceForUser(user.id);
		if (activeUser.current !== user.id || startedAt !== revision.current) return;
		if (!nextSpace && currentSpace.current) return;
		setSpace(nextSpace);
		setStatus(nextSpace ? "ready" : "none");
		if (nextSpace) {
			void writeSpaceSnapshot(user.id, nextSpace);
		}
	}, [repository, user]);

	useEffect(() => {
		if (sessionStatus !== 'signed_in' || !user) return;
		let previous = AppState.currentState;
		const subscription = AppState.addEventListener('change', (next) => {
			if (next === 'active' && previous !== 'active') {
				void refreshSpace().catch(() => undefined);
			}
			previous = next;
		});
		return () => subscription.remove();
	}, [refreshSpace, sessionStatus, user]);

	const value = useMemo<SpaceContextValue>(
		() => ({
			status,
			space,
			isHydrated,
			createSpace,
			joinSpace,
			updateSpace,
			clearSpace,
			leaveSpace,
			regenerateInvite,
			refreshSpace,
		}),
		[
			status,
			space,
			isHydrated,
			createSpace,
			joinSpace,
			updateSpace,
			clearSpace,
			leaveSpace,
			regenerateInvite,
			refreshSpace,
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
