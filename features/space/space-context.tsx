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
	const activeUser = useRef(sessionStatus === 'signed_in' ? user?.id : undefined);
	useLayoutEffect(() => {
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

		if (sessionStatus === "signed_out" || !user) {
			setStatus("none");
			setSpace(null);
			setIsHydrated(true);
			return;
		}

		const userId = user.id;

		setStatus("loading");
		setIsHydrated(false);

		async function hydrateSpace() {
			try {
				const nextSpace = await repository.getSpaceForUser(userId);

				if (!isActive) {
					return;
				}

				setSpace(nextSpace);
				setStatus(nextSpace ? "ready" : "none");
			} catch {
				if (!isActive) {
					return;
				}

				setSpace(null);
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
			const nextSpace = await repository.createSpace(input);
			if (!isStillActiveUser(user?.id)) return nextSpace;
			setSpace(nextSpace);
			setStatus("ready");
			return nextSpace;
		},
		[isStillActiveUser, repository, user?.id],
	);

	const joinSpace = useCallback(
		async (input: JoinSpaceInput) => {
			const joinedSpace = await repository.joinSpace(input);
			if (!isStillActiveUser(user?.id)) return joinedSpace;
			setSpace(joinedSpace);
			setStatus("ready");
			return joinedSpace;
		},
		[isStillActiveUser, repository, user?.id],
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
			if (!isStillActiveUser(user.id)) return nextSpace;
			setSpace(nextSpace);
			setStatus(nextSpace ? "ready" : "none");
			return nextSpace;
		},
		[isStillActiveUser, repository, user],
	);

	const clearSpace = useCallback(async () => {
		if (!user) {
			return;
		}

		await repository.clearSpaceForUser(user.id);
		if (!isStillActiveUser(user.id)) return;
		setSpace(null);
		setStatus("none");
	}, [isStillActiveUser, repository, user]);

	const leaveSpace = useCallback(async () => {
		if (!user) {
			return;
		}

		await repository.leaveSpace(user.id);
		if (!isStillActiveUser(user.id)) return;
		setSpace(null);
		setStatus("none");
	}, [isStillActiveUser, repository, user]);

	const regenerateInvite = useCallback(async () => {
		if (!user) {
			throw new Error("Not signed in.");
		}

		const inviteCode = await repository.regenerateInvite(user.id);
		// Re-read so expiry/joined state comes from the authority, not a guess.
		const refreshed = await repository.getSpaceForUser(user.id).catch(() => null);
		if (!isStillActiveUser(user.id)) return inviteCode;
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
		const nextSpace = await repository.getSpaceForUser(user.id);
		if (activeUser.current !== user.id) return;
		setSpace(nextSpace);
		setStatus(nextSpace ? "ready" : "none");
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
