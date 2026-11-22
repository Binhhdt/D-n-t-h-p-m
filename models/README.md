# Mô hình tách giọng hát

Ứng dụng dùng mô hình giọng hát **Open-Unmix HQ (UMX-HQ)** do nhóm Open-Unmix công bố dưới giấy phép MIT. Bản ONNX được chuyển từ checkpoint `vocals-b62c91ce.pth`. Mã chuyển đổi và đối chiếu đầu ra với mô hình gốc nằm tại [tools/export_umx.py](../tools/export_umx.py). [Trọng số và giấy phép trên Zenodo](https://doi.org/10.5281/zenodo.3370489) · [Thông báo giấy phép MIT](OPEN-UNMIX-LICENSE.txt)

- Kích thước ONNX 35.640.191 byte. SHA-256 `1b42b6574b0856a5105dfcdb4e8ab3b1d24efb5ef5301a7f5eb541b89e4cd0b4`.
- Android đóng gói trọng số và ONNX Runtime 1.22.0. Web hỏi trước khi tải trọng số và dùng Cache Storage để tái sử dụng nếu trình duyệt cấp chỗ lưu. Web nạp ONNX Runtime 1.22.0 từ CDN.
- Suy luận CPU dùng STFT 44,1 kHz. Mỗi lượt nhận tối đa 192 khung, với vùng ngữ cảnh và chuyển tiếp chồng lấn khoảng 0,74 giây giữa hai đoạn. Nhạc nền là phần hỗn hợp còn lại sau khi trừ vocal do mô hình ước lượng.
- Bộ nhớ PCM cho ba bản stereo ở 44,1 kHz xấp xỉ 1,06 MB mỗi giây. Ứng dụng tính giới hạn đọc file theo số kênh, thời lượng và bộ nhớ còn trống, có phần dự phòng cho giải mã, xuất file và ONNX Runtime. Thời gian xử lý phụ thuộc CPU và độ dài bài.

## Kiểm thử

`node --test tests/audio.test.cjs` kiểm tra hợp âm, chuyển tone và xử lý PCM theo đoạn. `python tests/model_test.py` chạy suy luận với ONNX Runtime 1.22.0. Có thể chạy thêm kiểm thử trên Chromium bằng `python tests/browser_test.py http://localhost:8000` sau khi phục vụ thư mục gốc và cài Python Playwright cùng Chromium.

Để chạy phép đo với bản thu GuitarSet có nhãn hợp âm và cao độ, cài `remotezip` và `ffmpeg`, tải dữ liệu bằng `python tests/fetch_guitarset.py /tmp/guitarset`, rồi chạy `CHORD_FIXTURES=/tmp/guitarset node --test tests/audio.test.cjs`. [GuitarSet, CC BY 4.0](https://doi.org/10.5281/zenodo.3371780)
