fn main() {
    let manifest_dir = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let proto_dir = manifest_dir.join("../../../contracts/orderhub");
    let proto = proto_dir.join("orderhub.proto");
    println!("cargo:rerun-if-changed={}", proto.display());
    println!(
        "cargo:rerun-if-changed={}",
        proto_dir.join("validation.json").display()
    );

    let protoc = protoc_bin_vendored::protoc_bin_path().expect("vendored protoc is unavailable");
    std::env::set_var("PROTOC", protoc);
    let out_dir = std::path::PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR"));
    let descriptor = out_dir.join("orderhub_descriptor.bin");

    // Use a deterministic descriptor path inside OUT_DIR instead of prost-build's
    // temp directory. This also lets diagnostics/tests inspect the frozen
    // descriptor without relying on the system temp directory.
    tonic_build::configure()
        .build_server(true)
        .build_client(true)
        .file_descriptor_set_path(descriptor)
        .compile_protos(&[proto], &[proto_dir])
        .expect("failed to compile orderhub.proto");

    tauri_build::build();
}
