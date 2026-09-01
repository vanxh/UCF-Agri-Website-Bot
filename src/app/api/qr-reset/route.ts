import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

function safeDelete(dirPath: string) {
    if (!fs.existsSync(dirPath)) return;
    try {
        fs.rmSync(dirPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (e) {
        console.error('Error removing directory:', dirPath, e);
    }
}

export async function POST() {
    try {
        const cwd = process.cwd();
        const tempDir = path.join(cwd, 'temp');
        const authPath = path.join(cwd, '.wwebjs_auth');
        const cachePath = path.join(cwd, '.wwebjs_cache');
        const qrImagePath = path.join(tempDir, 'qrcode.png');
        const metadataPath = path.join(tempDir, 'qr_metadata.json');

        // Delete old QR image
        if (fs.existsSync(qrImagePath)) {
            try { fs.unlinkSync(qrImagePath); } catch (e) {}
        }

        // Delete auth and cache directories to force fresh login & QR
        safeDelete(authPath);
        safeDelete(cachePath);

        // Update metadata
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        fs.writeFileSync(
            metadataPath,
            JSON.stringify({
                status: 'regenerating',
                message: 'QR code reset requested. Generating new QR code...',
                requested_at: new Date().toISOString()
            }, null, 2)
        );

        return NextResponse.json({
            success: true,
            message: 'Session reset requested. Fresh QR code will be generated.'
        });
    } catch (error: any) {
        console.error('Error resetting QR session:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
