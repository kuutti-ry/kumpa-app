import * as ImagePicker from "expo-image-picker";
import { setLocalCheck } from "./localCheck";
import { pickPhotos, pickPrepared, prepareForUpload, UPLOAD_LONG_EDGE } from "./pick";

const { ImageManipulator } = jest.requireMock("expo-image-manipulator") as {
  ImageManipulator: { manipulate: jest.Mock };
};
const launch = ImagePicker.launchImageLibraryAsync as jest.Mock;

beforeEach(() => {
  launch.mockReset();
  ImageManipulator.manipulate.mockClear();
});

describe("picking photos", () => {
  const asset = (name: string) => ({ uri: `file:///${name}.jpg`, width: 1200, height: 900 });

  it("asks for one still image without EXIF and reports a cancel as such", async () => {
    launch.mockResolvedValueOnce({ canceled: true, assets: null });
    expect(await pickPhotos()).toEqual({ kind: "cancelled" });
    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaTypes: ["images"],
        allowsMultipleSelection: false,
        exif: false,
      }),
    );
    expect(launch.mock.calls[0]?.[0]).not.toHaveProperty("selectionLimit");
  });

  it("returns the picked asset's uri and size, and nothing else of it", async () => {
    launch.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: "file:///a.heic", width: 4032, height: 3024, exif: { GPS: 1 } }],
    });
    expect(await pickPhotos()).toEqual({
      kind: "picked",
      assets: [{ uri: "file:///a.heic", width: 4032, height: 3024 }],
    });
  });

  it("asks for as many as there is room for, in the order picked, and hands them back in that order (#681)", async () => {
    launch.mockResolvedValueOnce({ canceled: false, assets: [asset("b"), asset("a")] });
    expect(await pickPhotos(4)).toEqual({ kind: "picked", assets: [asset("b"), asset("a")] });
    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({
        allowsMultipleSelection: true,
        selectionLimit: 4,
        orderedSelection: true,
        allowsEditing: false,
      }),
    );
  });

  it("holds a picker that hands back more than the limit to it", async () => {
    launch.mockResolvedValueOnce({
      canceled: false,
      assets: [asset("a"), asset("b"), asset("c")],
    });
    expect(await pickPhotos(2)).toEqual({ kind: "picked", assets: [asset("a"), asset("b")] });
  });

  it.each([
    [1, "one"],
    [0, "no room"],
    [-3, "less than none"],
    [1.7, "a fraction"],
  ])("asks for one photo, never the system's most, given %p (%s)", async (limit) => {
    launch.mockResolvedValueOnce({ canceled: false, assets: [asset("a"), asset("b")] });
    expect(await pickPhotos(limit)).toEqual({ kind: "picked", assets: [asset("a")] });
    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({ allowsMultipleSelection: false }),
    );
    expect(launch.mock.calls[0]?.[0]).not.toHaveProperty("selectionLimit");
  });

  it("reads a finished pick that hands back no asset as a cancel", async () => {
    launch.mockResolvedValueOnce({ canceled: false, assets: [] });
    expect(await pickPhotos()).toEqual({ kind: "cancelled" });
    launch.mockResolvedValueOnce({ canceled: false, assets: null });
    expect(await pickPhotos(3)).toEqual({ kind: "cancelled" });
  });

  it("reads a picker that throws as a denied permission", async () => {
    launch.mockRejectedValueOnce(new Error("Missing permission"));
    expect(await pickPhotos()).toEqual({ kind: "denied" });
  });
});

describe("preparing for upload", () => {
  it("resizes a landscape picture to 1600 px wide and saves a JPEG", async () => {
    const prepared = await prepareForUpload({ uri: "file:///a.heic", width: 4032, height: 3024 });
    const context = ImageManipulator.manipulate.mock.results[0]?.value as {
      resize: jest.Mock;
    };
    expect(context.resize).toHaveBeenCalledWith({ width: UPLOAD_LONG_EDGE });
    expect(prepared).toEqual({
      uri: "file:///a.heic#resized",
      width: 1600,
      height: 1067,
      mimeType: "image/jpeg",
    });
  });

  it("resizes a portrait picture by its height", async () => {
    await prepareForUpload({ uri: "file:///p.jpg", width: 3000, height: 4000 });
    const context = ImageManipulator.manipulate.mock.results[0]?.value as {
      resize: jest.Mock;
    };
    expect(context.resize).toHaveBeenCalledWith({ height: UPLOAD_LONG_EDGE });
  });

  it("re-saves a small picture without resizing, so its EXIF goes all the same", async () => {
    const prepared = await prepareForUpload({ uri: "file:///s.jpg", width: 800, height: 600 });
    const context = ImageManipulator.manipulate.mock.results[0]?.value as {
      resize: jest.Mock;
    };
    expect(context.resize).not.toHaveBeenCalled();
    expect(prepared.uri).toBe("file:///s.jpg#resized");
    expect(prepared.mimeType).toBe("image/jpeg");
  });
});

describe("the chain before an upload (#48, #350)", () => {
  afterEach(() => setLocalCheck(null));

  it("picks, checks and resizes", async () => {
    launch.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: "file:///a.heic", width: 4032, height: 3024 }],
    });
    expect(await pickPrepared()).toEqual({
      kind: "picked",
      photo: { uri: "file:///a.heic#resized", width: 1600, height: 1067, mimeType: "image/jpeg" },
    });
  });

  it("hands back a cancel and a denied library as they came, preparing nothing", async () => {
    launch.mockResolvedValueOnce({ canceled: true, assets: null });
    expect(await pickPrepared()).toEqual({ kind: "cancelled" });
    launch.mockRejectedValueOnce(new Error("Missing permission"));
    expect(await pickPrepared()).toEqual({ kind: "denied" });
    expect(ImageManipulator.manipulate).not.toHaveBeenCalled();
  });

  it("stops at the on-device check's refusal, before the resize", async () => {
    launch.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: "file:///nude.jpg", width: 1200, height: 900 }],
    });
    const checked: string[] = [];
    setLocalCheck(async (uri) => {
      checked.push(uri);
      return "refuse";
    });
    expect(await pickPrepared()).toEqual({ kind: "refused_local" });
    expect(checked).toEqual(["file:///nude.jpg"]);
    expect(ImageManipulator.manipulate).not.toHaveBeenCalled();
  });
});
