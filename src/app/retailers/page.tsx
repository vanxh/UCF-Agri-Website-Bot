"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Plus, Pencil, Trash2, Loader2, Upload } from "lucide-react";
import { BulkImportDialog } from "@/components/BulkImportDialog";

interface Retailer {
    id: string;
    name: string;
    full_name: string;
    created_at: string;
}

export default function RetailersPage() {
    const [retailers, setRetailers] = useState<Retailer[]>([]);
    const [loading, setLoading] = useState(true);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [bulkImportOpen, setBulkImportOpen] = useState(false);
    const [editingRetailer, setEditingRetailer] = useState<Retailer | null>(null);
    const [formData, setFormData] = useState<Partial<Retailer>>({});

    useEffect(() => {
        fetchRetailers();
    }, []);

    const fetchRetailers = async () => {
        setLoading(true);
        const res = await fetch("/api/retailers");
        const data = await res.json();
        setRetailers(data);
        setLoading(false);
    };

    const handleAdd = () => {
        setEditingRetailer(null);
        setFormData({
            name: "",
            full_name: "",
        });
        setDialogOpen(true);
    };

    const handleEdit = (retailer: Retailer) => {
        setEditingRetailer(retailer);
        setFormData(retailer);
        setDialogOpen(true);
    };

    const handleSave = async () => {
        if (!formData.name || !formData.full_name) {
            alert("Retailer name and full name are required");
            return;
        }

        const method = editingRetailer ? "PUT" : "POST";
        await fetch("/api/retailers", {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(formData),
        });

        setDialogOpen(false);
        fetchRetailers();
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Are you sure you want to delete this retailer?")) return;

        await fetch("/api/retailers", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id }),
        });

        fetchRetailers();
    };

    const handleBulkImport = async (data: any[], format: "csv" | "json") => {
        const response = await fetch("/api/retailers/bulk", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ data, format }),
        });

        if (response.ok) {
            setBulkImportOpen(false);
            fetchRetailers();
        } else {
            alert("Bulk import failed");
        }
    };

    return (
        <div className="p-8">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-3xl font-bold">UCF Authorized Retailers</h1>
                    <p className="text-muted-foreground mt-1">
                        Manage authorized retailers for receipt verification
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button onClick={() => setBulkImportOpen(true)} variant="outline">
                        <Upload className="mr-2 h-4 w-4" />
                        Bulk Import
                    </Button>
                    <Button onClick={handleAdd}>
                        <Plus className="mr-2 h-4 w-4" />
                        Add Retailer
                    </Button>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center items-center h-64">
                    <Loader2 className="h-8 w-8 animate-spin" />
                </div>
            ) : (
                <div className="border rounded-lg">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead>Full Name</TableHead>
                                <TableHead>Created Date</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {retailers.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                                        No retailers found. Add your first retailer to get started.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                retailers.map((retailer) => (
                                    <TableRow key={retailer.id}>
                                        <TableCell className="font-medium">{retailer.name}</TableCell>
                                        <TableCell>{retailer.full_name}</TableCell>
                                        <TableCell>
                                            {new Date(retailer.created_at).toLocaleDateString()}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleEdit(retailer)}
                                            >
                                                <Pencil className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleDelete(retailer.id)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            )}

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {editingRetailer ? "Edit Retailer" : "Add New Retailer"}
                        </DialogTitle>
                        <DialogDescription>
                            {editingRetailer
                                ? "Update retailer information"
                                : "Add a new authorized retailer"}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="name">Retailer Name</Label>
                            <Input
                                id="name"
                                value={formData.name || ""}
                                onChange={(e) =>
                                    setFormData({ ...formData, name: e.target.value })
                                }
                                placeholder="e.g., Farmbiz"
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="full_name">Full Legal Name</Label>
                            <Input
                                id="full_name"
                                value={formData.full_name || ""}
                                onChange={(e) =>
                                    setFormData({ ...formData, full_name: e.target.value })
                                }
                                placeholder="e.g., FARMBIZ PVT LTD"
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleSave}>
                            {editingRetailer ? "Update" : "Add"} Retailer
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <BulkImportDialog
                isOpen={bulkImportOpen}
                onClose={() => setBulkImportOpen(false)}
                onImport={handleBulkImport}
                entityName="Retailers"
                exampleCsv={`name,full_name
Farmbiz,FARMBIZ PVT LTD
Mega Save,MEGA SAVE`}
                exampleJson={`[
  { "name": "Farmbiz", "full_name": "FARMBIZ PVT LTD" },
  { "name": "Mega Save", "full_name": "MEGA SAVE" }
]`}
            />
        </div>
    );
}
