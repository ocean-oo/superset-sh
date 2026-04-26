import { auth } from "@superset/auth/server";
import { createTRPCContext } from "@superset/trpc";


export const createContext = async ({
	req,
}: {
	req: Request;
	resHeaders: Headers;
}) => {
	let session = await auth.api.getSession({
		headers: req.headers,
	});

	// Custom: Provide mock session for local-only enterprise build
	if (!session) {
		session = {
			user: {
				id: "local-user-id",
				email: "local@superset.sh",
				name: "Local User",
				emailVerified: true,
				image: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			session: {
				id: "local-session-id",
				userId: "local-user-id",
				expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
				token: "local-enterprise-token",
				createdAt: new Date(),
				updatedAt: new Date(),
				activeOrganizationId: "mock-org-id",
				organizationIds: ["mock-org-id"],
				role: "owner",
				plan: "enterprise",
			},
		} as any;
	}

	return createTRPCContext({
		session,
		auth,
		headers: req.headers,
	});
};
