/**
 * Semantic Engine — Endpoint Test Script
 * Run with: node test_endpoints.mjs
 */

const BASE = "http://localhost:3003";
const TEST_USER_ID = 123456789;

async function test(label, fn) {
    try {
        const result = await fn();
        console.log(`✅ ${label}:`, JSON.stringify(result, null, 2));
        return result;
    } catch (err) {
        console.error(`❌ ${label}:`, err.message);
        return null;
    }
}

async function main() {
    console.log("\n🚀 Testing Semantic Engine Endpoints\n");

    // 1. Health check
    await test("Health Check", async () => {
        const res = await fetch(`${BASE}/health`);
        return res.json();
    });

    // 2. Create a job folder
    const folder = await test("Create Job Folder", async () => {
        const res = await fetch(`${BASE}/folders`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: TEST_USER_ID, name: "Test Project" }),
        });
        return res.json();
    });

    // 3. List folders
    await test("List Folders", async () => {
        const res = await fetch(`${BASE}/folders?user_id=${TEST_USER_ID}`);
        return res.json();
    });

    // 4. Upload a text file (auto file-type folder)
    const uploadResult = await test("Upload Text File", async () => {
        const formData = new FormData();
        formData.append("user_id", String(TEST_USER_ID));
        formData.append("file", new Blob(["This is a test document about machine learning and neural networks. Deep learning has revolutionized AI."], { type: "text/plain" }), "test.txt");

        const res = await fetch(`${BASE}/upload`, {
            method: "POST",
            body: formData,
        });
        return res.json();
    });

    // 5. List files for user
    await test("List Files", async () => {
        const res = await fetch(`${BASE}/files?user_id=${TEST_USER_ID}`);
        return res.json();
    });

    // 6. Get file detail (if upload succeeded)
    if (uploadResult?.id) {
        await test("Get File Detail", async () => {
            const res = await fetch(`${BASE}/files/${uploadResult.id}`);
            return res.json();
        });
    }

    // 7. Get folder detail (if created)
    if (folder?.folder?.id) {
        await test("Get Folder Detail", async () => {
            const res = await fetch(`${BASE}/folders/${folder.folder.id}`);
            return res.json();
        });
    }

    // 8. Wait a bit for worker to process, then search
    console.log("\n⏳ Waiting 10s for worker to process...\n");
    await new Promise((r) => setTimeout(r, 10000));

    await test("Semantic Search", async () => {
        const res = await fetch(`${BASE}/search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                query: "neural networks",
                user_id: TEST_USER_ID,
                limit: 5,
            }),
        });
        return res.json();
    });

    // 9. Check file status after worker
    if (uploadResult?.id) {
        await test("File Status After Worker", async () => {
            const res = await fetch(`${BASE}/files/${uploadResult.id}`);
            return res.json();
        });
    }

    console.log("\n✅ All tests complete!\n");
}

main().catch(console.error);
