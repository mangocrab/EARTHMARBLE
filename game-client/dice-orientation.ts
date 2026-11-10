import { Quaternion, Vector3 } from "three";
export const DICE_FACES = [1, 6, 2, 5, 3, 4];
export const FACE_NORMALS: Record<number, Vector3> = {
  1: new Vector3(1, 0, 0),
  6: new Vector3(-1, 0, 0),
  2: new Vector3(0, 1, 0),
  5: new Vector3(0, -1, 0),
  3: new Vector3(0, 0, 1),
  4: new Vector3(0, 0, -1),
};
export function diceOrientation(face: number) {
  if (!FACE_NORMALS[face]) throw new Error("Invalid dice face");
  return new Quaternion().setFromUnitVectors(
    FACE_NORMALS[face],
    new Vector3(0, 1, 0),
  );
}
export function topFace(q: Quaternion) {
  return DICE_FACES.reduce((a, b) =>
    FACE_NORMALS[a].clone().applyQuaternion(q).y >=
    FACE_NORMALS[b].clone().applyQuaternion(q).y
      ? a
      : b,
  );
}
