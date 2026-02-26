import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2">
            <AlertCircle className="h-8 w-8 text-red-500" />
            <h1 className="text-2xl font-bold text-gray-900">404 Page Not Found</h1>
          </div>

          <p className="mt-4 text-sm text-gray-600">
            This page doesn't exist. Check the address or use the links below to get back.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <Link href="/" className="text-sm font-medium text-primary hover:underline">Go to Home</Link>
            <Link href="/client/login" className="text-sm font-medium text-primary hover:underline">Client login</Link>
            <Link href="/staff/login" className="text-sm font-medium text-primary hover:underline">Staff login</Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
