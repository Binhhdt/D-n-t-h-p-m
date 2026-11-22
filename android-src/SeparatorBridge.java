package com.vocaltool.donothopam;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtException;
import ai.onnxruntime.OrtSession;
import android.app.ActivityManager;
import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import java.io.FileInputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.nio.channels.FileChannel;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Only available to the packaged WebView page. Accepts bounded FFT tensors. */
public final class SeparatorBridge {
    private static final String MODEL = "models/umxhq-vocals.onnx";
    private static final int MAX_FRAMES = 192;
    private static final int BINS = 2049;
    private static final int TRANSFER = 49152;
    private final Context app;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private int generation = 0;
    private Job active;
    private boolean closed;

    private static final class Job {
        final int id;
        OrtSession session;
        OrtSession.RunOptions run;
        ByteBuffer input;
        byte[] output;
        int frames;
        String state = "loading";

        Job(int id) {
            this.id = id;
        }
    }

    public SeparatorBridge(Context context) {
        app = context.getApplicationContext();
    }

    @JavascriptInterface
    public int budgetMiB() {
        ActivityManager manager = (ActivityManager) app.getSystemService(Context.ACTIVITY_SERVICE);
        if (manager == null) return 0;
        ActivityManager.MemoryInfo memory = new ActivityManager.MemoryInfo();
        manager.getMemoryInfo(memory);
        if (memory.lowMemory) return 0;
        // Leave room for ORT, WebView, and the rest of the app and system.
        return (int) Math.max(0, Math.min(430, (memory.availMem - memory.threshold) / (3 * 1048576L) - 96));
    }

    @JavascriptInterface
    public synchronized int open() {
        if (closed || active != null || budgetMiB() < 20) return 0;
        Job job = new Job(++generation);
        active = job;
        worker.execute(() -> load(job));
        return job.id;
    }

    private void load(Job job) {
        synchronized (this) {
            if (active != job) return;
        }
        try (AssetFileDescriptor asset = app.getAssets().openFd(MODEL);
             FileInputStream stream = asset.createInputStream();
             OrtSession.SessionOptions options = new OrtSession.SessionOptions()) {
            ByteBuffer model = stream.getChannel().map(
                    FileChannel.MapMode.READ_ONLY, asset.getStartOffset(), asset.getLength());
            options.setIntraOpNumThreads(Math.min(2, Runtime.getRuntime().availableProcessors()));
            options.setInterOpNumThreads(1);
            job.session = OrtEnvironment.getEnvironment().createSession(model, options);
            synchronized (this) {
                if (active == job) job.state = "ready";
            }
        } catch (Exception | OutOfMemoryError error) {
            fail(job);
        }
    }

    @JavascriptInterface
    public synchronized String status(int id) {
        return active != null && active.id == id ? active.state : "closed";
    }

    @JavascriptInterface
    public synchronized boolean begin(int id, int frames) {
        if (active == null || active.id != id || frames < 1 || frames > MAX_FRAMES ||
                !(active.state.equals("ready") || active.state.equals("done"))) return false;
        try {
            active.output = null;
            active.frames = frames;
            active.input = ByteBuffer.allocateDirect(frames * 2 * BINS * Float.BYTES)
                    .order(ByteOrder.LITTLE_ENDIAN);
            active.state = "input";
            return true;
        } catch (OutOfMemoryError error) {
            fail(active);
            return false;
        }
    }

    @JavascriptInterface
    public synchronized boolean write(int id, String encoded) {
        if (active == null || active.id != id || !active.state.equals("input") ||
                encoded == null || encoded.length() > 4 * TRANSFER / 3) return false;
        try {
            byte[] data = Base64.decode(encoded, Base64.NO_WRAP);
            if (data.length > active.input.remaining()) return false;
            active.input.put(data);
            return true;
        } catch (IllegalArgumentException | OutOfMemoryError error) {
            fail(active);
            return false;
        }
    }

    @JavascriptInterface
    public synchronized boolean infer(int id) {
        if (active == null || active.id != id || !active.state.equals("input") || active.input.hasRemaining()) {
            return false;
        }
        Job job = active;
        job.input.flip();
        job.state = "running";
        worker.execute(() -> run(job));
        return true;
    }

    private void run(Job job) {
        try (OrtSession.RunOptions run = new OrtSession.RunOptions()) {
            FloatBuffer input;
            synchronized (this) {
                if (active != job) return;
                job.run = run;
                input = job.input.asFloatBuffer();
            }
            byte[] encoded;
            try (OnnxTensor tensor = OnnxTensor.createTensor(OrtEnvironment.getEnvironment(),
                         input, new long[]{job.frames, 2, BINS});
                 OrtSession.Result result = job.session.run(Collections.singletonMap("magnitude", tensor), run)) {
                FloatBuffer values = ((OnnxTensor) result.get(0)).getFloatBuffer();
                encoded = new byte[values.remaining() * Float.BYTES];
                ByteBuffer.wrap(encoded).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer().put(values);
            } finally {
                synchronized (this) {
                    job.run = null;
                    job.input = null;
                }
            }
            synchronized (this) {
                if (active == job) {
                    job.output = encoded;
                    job.state = "done";
                }
            }
        } catch (Exception | OutOfMemoryError error) {
            fail(job);
        }
    }

    @JavascriptInterface
    public synchronized String read(int id, int offset, int size) {
        if (active == null || active.id != id || !active.state.equals("done") ||
                offset < 0 || size < 1 || size > TRANSFER || offset > active.output.length - size) return "";
        return Base64.encodeToString(active.output, offset, size, Base64.NO_WRAP);
    }

    private synchronized void fail(Job job) {
        if (active == job) {
            job.run = null;
            job.input = null;
            job.output = null;
            job.state = "error";
        }
    }

    @JavascriptInterface
    public synchronized void end(int id) {
        if (active != null && active.id == id) release();
    }

    private void release() {
        Job job = active;
        active = null;
        if (job.run != null) {
            try {
                job.run.setTerminate(true);
            } catch (OrtException ignored) {
                // Disposal is queued after this inference returns.
            }
        }
        worker.execute(() -> {
            job.input = null;
            job.output = null;
            if (job.session != null) {
                try {
                    job.session.close();
                } catch (OrtException ignored) {
                    // The activity may already be gone.
                }
            }
        });
    }

    public synchronized void close() {
        closed = true;
        if (active != null) release();
        worker.shutdown();
    }
}
