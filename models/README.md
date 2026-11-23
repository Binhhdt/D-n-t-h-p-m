# Mô hình tách giọng hát

Bản 1.2 dùng **UVR-MDX-NET-Inst_Main** của nhóm Ultimate Vocal Remover (UVR), theo giấy phép MIT và yêu cầu ghi nguồn của nhóm. Bản đóng gói giữ nguyên trọng số và đổi chiều thời gian từ 256 xuống 96 khung để giới hạn bộ nhớ. Có thể tạo lại bằng `python tools/prepare_mdx.py path/to/UVR-MDX-NET-Inst_Main.onnx` với `onnx==1.19.1`. [Mô hình nguồn](https://github.com/k2-fsa/sherpa-onnx/releases/download/source-separation-models/UVR-MDX-NET-Inst_Main.onnx) · [UVR và giấy phép](https://github.com/Anjok07/ultimatevocalremovergui#license)

- Kích thước ONNX 52.787.031 byte. SHA-256 `022c3c149be3a2203ff352b331f4a443fab12b2d95ccbe7aad021a1fd2637c46`.
- Android đóng gói trọng số và ONNX Runtime 1.22.0. Web hỏi trước khi tải trọng số và tái sử dụng từ Cache Storage nếu trình duyệt cấp chỗ lưu. Web tải runtime WASM từ CDN.
- Mô hình dự đoán phổ phức của nhạc nền ở 44,1 kHz. Ứng dụng tái tạo từng kênh qua iSTFT và ghép chồng lấn khoảng 0,37 giây. Vocal nhận phần còn lại của bản phối.
- Suy luận một tensor 96 khung bằng ONNX Runtime CPU trên Linux chiếm khoảng 371 MiB RSS đỉnh trong phép thử độc lập. Android kiểm tra bộ nhớ khả dụng trước khi chạy và dự trù 400 MiB cho mô hình. Ba bản PCM stereo chiếm khoảng 1,06 MB mỗi giây, ngoài phần dự trù cho giải mã và xuất file.

## Kiểm thử

`node --test tests/audio.test.cjs` kiểm tra khôi phục PCM qua STFT/iSTFT, hủy xử lý và các tính năng hợp âm hiện có. `python tests/model_test.py` chạy suy luận với ONNX Runtime 1.22.0.

Để chạy kiểm thử giao diện, phục vụ thư mục gốc bằng `python -m http.server 8000` sau khi cài Chromium và Python Playwright. `python tests/browser_test.py http://localhost:8000` kiểm tra metadata và chức năng cũ. `python tests/separator_browser_test.py http://localhost:8000 mix.wav mix.mp3` kiểm tra luồng tách thực với hai bản stereo dài ít nhất 10 giây và cần thêm `ffmpeg`.

Để chạy phép đo hợp âm và cao độ bằng bản thu GuitarSet có nhãn, cài `remotezip` và `ffmpeg`, tải dữ liệu bằng `python tests/fetch_guitarset.py /tmp/guitarset`, rồi chạy `CHORD_FIXTURES=/tmp/guitarset node --test tests/audio.test.cjs`. [GuitarSet, CC BY 4.0](https://doi.org/10.5281/zenodo.3371780)
