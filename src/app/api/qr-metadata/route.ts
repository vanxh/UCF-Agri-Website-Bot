import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
    try {
        const metadataPath = path.join(process.cwd(), 'temp', 'qr_metadata.json');
        const qrImagePath = path.join(process.cwd(), 'temp', 'qrcode.png');
        const hasImage = fs.existsSync(qrImagePath);

        if (!fs.existsSync(metadataPath)) {
            return NextResponse.json(
                {
                    status: hasImage ? 'qr_ready' : 'waiting',
                    has_image: hasImage,
                    message: hasImage ? 'QR code available' : 'Waiting for bot to generate QR code...',
                    age_seconds: 0
                },
                {
                    status: 200,
                    headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' }
                }
            );
        }

        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        const genTime = metadata.generated_at ? new Date(metadata.generated_at).getTime() : Date.now();
        const ageSeconds = Math.max(0, Math.floor((Date.now() - genTime) / 1000));

        return NextResponse.json({
            ...metadata,
            has_image: hasImage,
            age_seconds: ageSeconds
        }, {
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        });
    } catch (error) {
        console.error('Error reading QR metadata:', error);
        return NextResponse.json(
            { error: 'Failed to load QR metadata', status: 'error' },
            { status: 500 }
        );
    }
}
