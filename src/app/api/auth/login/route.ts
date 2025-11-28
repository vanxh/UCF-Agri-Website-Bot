import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { username, password } = body;

        console.log("[LOGIN] Attempt:", { username, passwordLength: password?.length });
        console.log("[LOGIN] NODE_ENV:", process.env.NODE_ENV);

        // Check credentials
        if (username === "UCF ADMIN" && password === "Add1ngt0N@26") {
            console.log("[LOGIN] Credentials valid, setting cookie...");

            const response = NextResponse.json({ success: true });

            // Set HTTP-only cookie
            // Use lax sameSite for better compatibility with proxies
            response.cookies.set("admin_session", "true", {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "lax",
                maxAge: 60 * 60 * 24, // 1 day
                path: "/",
            });

            console.log("[LOGIN] Cookie set, returning success response");
            return response;
        }

        console.log("[LOGIN] Invalid credentials");
        return NextResponse.json(
            { error: "Invalid credentials" },
            { status: 401 }
        );
    } catch (error) {
        console.error("[LOGIN] Error:", error);
        return NextResponse.json(
            { error: "Internal server error", details: String(error) },
            { status: 500 }
        );
    }
}
