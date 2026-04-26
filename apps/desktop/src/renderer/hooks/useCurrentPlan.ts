import {
	isActiveSubscriptionStatus,
	type PlanTier,
} from "@superset/shared/billing";
import { useLiveQuery } from "@tanstack/react-db";
import { authClient } from "renderer/lib/auth-client";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";

interface ResolveCurrentPlanArgs {
	subscriptionPlan?: string | null;
	sessionPlan?: string | null;
	subscriptionsLoaded: boolean;
}

function isPaidPlanTier(
	plan: string | null | undefined,
): plan is "pro" | "enterprise" {
	return plan === "pro" || plan === "enterprise";
}

export function resolveCurrentPlan({
	subscriptionPlan,
	sessionPlan,
	subscriptionsLoaded,
}: ResolveCurrentPlanArgs): PlanTier {
	return "enterprise";
}

export function useCurrentPlan(): PlanTier {
	return "enterprise";
}
