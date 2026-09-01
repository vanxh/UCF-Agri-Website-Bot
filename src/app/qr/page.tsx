'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface QRMetadata {
    status?: 'qr_ready' | 'authenticated' | 'ready' | 'waiting' | 'regenerating' | 'disconnected' | 'auth_failure';
    generated_at?: string;
    ready_at?: string;
    authenticated_at?: string;
    qr_hash?: string;
    age_seconds?: number;
    has_image?: boolean;
    bot_name?: string;
    reason?: string;
}

export default function QRCodePage() {
    const [imageKey, setImageKey] = useState<number>(Date.now());
    const [metadata, setMetadata] = useState<QRMetadata | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [imageLoaded, setImageLoaded] = useState<boolean>(false);
    const [imageError, setImageError] = useState<boolean>(false);
    const [isResetting, setIsResetting] = useState<boolean>(false);
    const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

    const fetchMetadata = useCallback(async () => {
        try {
            const res = await fetch(`/api/qr-metadata?t=${Date.now()}`);
            if (res.ok) {
                const data: QRMetadata = await res.json();
                setMetadata(data);
            }
        } catch (e) {
            console.error('Error fetching metadata:', e);
        }
    }, []);

    // Polling metadata and image key
    useEffect(() => {
        fetchMetadata();
        setLoading(false);

        const interval = setInterval(() => {
            fetchMetadata();
            setImageKey(Date.now());
        }, 2500);

        return () => clearInterval(interval);
    }, [fetchMetadata]);

    const handleForceNewQR = async () => {
        setIsResetting(true);
        setFeedbackMessage('Requesting fresh QR code...');
        try {
            const res = await fetch('/api/qr-reset', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                setFeedbackMessage('Cleared previous session. Generating a new QR code...');
                setImageLoaded(false);
                setImageError(false);
                setImageKey(Date.now());
                await fetchMetadata();
            } else {
                setFeedbackMessage(data.error || 'Failed to request reset');
            }
        } catch (e: any) {
            setFeedbackMessage('Error connecting to reset endpoint');
        } finally {
            setTimeout(() => {
                setIsResetting(false);
                setTimeout(() => setFeedbackMessage(null), 3000);
            }, 1000);
        }
    };

    const isConnected = metadata?.status === 'ready' || metadata?.status === 'authenticated';
    const isReadyQR = metadata?.status === 'qr_ready' || metadata?.has_image;

    return (
        <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-blue-50 py-10 px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl mx-auto">
                {/* Header */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-600 text-white shadow-lg shadow-emerald-200 mb-4">
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                        </svg>
                    </div>
                    <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
                        WhatsApp Bot QR Connection
                    </h1>
                    <p className="mt-2 text-base text-slate-600">
                        Scan the auto-renewing QR code with your WhatsApp app to link UCF Agri-Bot.
                    </p>
                </div>

                {/* Main Card */}
                <div className="bg-white/90 backdrop-blur-sm rounded-3xl shadow-xl border border-slate-100 p-6 sm:p-8 mb-6">
                    {/* Live Status Header */}
                    <div className="flex flex-wrap items-center justify-between gap-3 pb-6 border-b border-slate-100">
                        <div className="flex items-center gap-2.5">
                            <span className="relative flex h-3.5 w-3.5">
                                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                                    isConnected ? 'bg-emerald-400' : 'bg-blue-400'
                                }`} />
                                <span className={`relative inline-flex rounded-full h-3.5 w-3.5 ${
                                    isConnected ? 'bg-emerald-500' : 'bg-blue-600'
                                }`} />
                            </span>
                            <span className="text-sm font-semibold text-slate-800">
                                {isConnected
                                    ? 'Bot Connected & Online'
                                    : metadata?.status === 'qr_ready' || metadata?.has_image
                                    ? 'Live QR Code Active'
                                    : 'Initializing Bot Session...'}
                            </span>
                        </div>

                        {metadata?.age_seconds !== undefined && !isConnected && (
                            <span className="text-xs font-medium px-3 py-1 rounded-full bg-slate-100 text-slate-600">
                                Age: {metadata.age_seconds}s
                            </span>
                        )}
                    </div>

                    {/* QR Display Area */}
                    <div className="flex flex-col items-center justify-center py-6">
                        {isConnected ? (
                            <div className="text-center py-8 px-4">
                                <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-emerald-100 text-emerald-600 mb-4 animate-bounce">
                                    <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                    </svg>
                                </div>
                                <h2 className="text-2xl font-bold text-slate-800 mb-1">
                                    {metadata?.bot_name ? `${metadata.bot_name} is Online!` : 'Bot Connected Successfully!'}
                                </h2>
                                <p className="text-slate-600 mb-6 text-sm max-w-md mx-auto">
                                    The WhatsApp bot is authenticated and actively listening for incoming messages.
                                </p>
                                <div className="flex flex-wrap justify-center gap-3">
                                    <Link
                                        href="/"
                                        className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-5 py-2.5 rounded-xl shadow-md transition-colors"
                                    >
                                        Go to Dashboard
                                    </Link>
                                    <button
                                        onClick={handleForceNewQR}
                                        disabled={isResetting}
                                        className="inline-flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium px-4 py-2.5 rounded-xl transition-colors text-sm"
                                    >
                                        {isResetting ? 'Resetting...' : 'Disconnect & Re-Pair'}
                                    </button>
                                </div>
                            </div>
                        ) : isReadyQR && !imageError ? (
                            <div className="relative group">
                                <div className="p-3 bg-white rounded-2xl shadow-md border-2 border-emerald-500/80">
                                    <img
                                        src={`/api/qr-image?t=${imageKey}`}
                                        alt="WhatsApp QR Code"
                                        className="w-72 h-72 sm:w-80 sm:h-80 object-contain rounded-lg"
                                        onLoad={() => {
                                            setImageLoaded(true);
                                            setImageError(false);
                                        }}
                                        onError={() => {
                                            if (metadata?.has_image === false) {
                                                setImageError(true);
                                            }
                                        }}
                                    />
                                </div>

                                <div className="absolute -top-2.5 -right-2.5 bg-emerald-600 text-white text-xs font-bold px-2.5 py-1 rounded-full shadow-lg flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full bg-white animate-ping"></span>
                                    LIVE
                                </div>
                            </div>
                        ) : (
                            <div className="text-center py-12 px-4">
                                <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-emerald-500 border-t-transparent mb-4"></div>
                                <h3 className="text-lg font-semibold text-slate-800 mb-1">
                                    Generating Fresh QR Code...
                                </h3>
                                <p className="text-slate-500 text-sm max-w-sm mx-auto">
                                    Please make sure the bot process is running (<code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs text-emerald-700">npm run bot</code>). The QR code will appear here automatically.
                                </p>
                            </div>
                        )}

                        {/* Action buttons & feedback */}
                        {feedbackMessage && (
                            <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium rounded-xl">
                                {feedbackMessage}
                            </div>
                        )}

                        {!isConnected && (
                            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                                <button
                                    onClick={handleForceNewQR}
                                    disabled={isResetting}
                                    className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-sm transition-colors"
                                >
                                    <svg className={`w-4 h-4 ${isResetting ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                    {isResetting ? 'Generating...' : 'Generate New QR Code'}
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Instructions */}
                <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-slate-100 shadow-sm p-6 mb-6">
                    <h3 className="text-base font-semibold text-slate-800 mb-4 flex items-center gap-2">
                        <span>📲</span> How to Link WhatsApp
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm text-slate-700">
                        <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-500 text-white font-bold text-xs flex items-center justify-center">1</span>
                            <span>Open WhatsApp on your phone</span>
                        </div>
                        <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-500 text-white font-bold text-xs flex items-center justify-center">2</span>
                            <span>Go to <strong>Settings &gt; Linked Devices</strong></span>
                        </div>
                        <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-500 text-white font-bold text-xs flex items-center justify-center">3</span>
                            <span>Tap <strong>Link a Device</strong></span>
                        </div>
                        <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-500 text-white font-bold text-xs flex items-center justify-center">4</span>
                            <span>Scan this code directly on screen</span>
                        </div>
                    </div>
                </div>

                {/* Back Button */}
                <div className="text-center">
                    <Link
                        href="/"
                        className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 font-medium text-sm transition-colors py-2 px-4 rounded-xl hover:bg-slate-100"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                        </svg>
                        Back to Dashboard
                    </Link>
                </div>
            </div>
        </div>
    );
}
